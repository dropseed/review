//! The manager-wide event bus: what happened to *some* session.
//!
//! [`super::TerminalMessage`] answers "what is this one session doing?" and is
//! delivered per session, to whoever subscribed to it. This channel answers the
//! question nothing else on the wire could: "what is happening on this daemon?"
//! — which is what lets a client stop polling `list` to notice a session
//! somebody else started.
//!
//! ## The invariant
//!
//! A subscriber that takes one [`SessionManager::list`] *after* subscribing and
//! then applies every event in order holds exactly the list `list` would
//! return at any later moment. Every place that changes the set of listed
//! sessions — or a listed session's status, size, or workspace — publishes
//! here. Two consequences worth stating, because they are easy to get wrong:
//!
//! - `list` hides a session from the instant its child exits, long before the
//!   poller reaps it out of the map. So exiting **is** leaving the list:
//!   [`SessionEvent::Exited`] is always followed by [`SessionEvent::Removed`].
//! - A session that was spawned but never accepted into the map (a duplicate
//!   id) publishes nothing at all. It was never in the list, so nothing about
//!   it may reach a subscriber — least of all a `Removed` naming the id of the
//!   *live* session it collided with.
//!
//! ## Bounded, and lagging is not fatal
//!
//! A [`tokio::sync::broadcast`] channel, so a subscriber that falls behind is
//! told it did ([`RecvError::Lagged`]) and then keeps receiving, rather than
//! being dropped like a slow per-session subscriber. Losing events breaks the
//! invariant above but not the connection: the subscriber re-`list`s and
//! carries on. The transport turns that into a `lagged` frame.
//!
//! [`SessionManager::list`]: super::SessionManager::list
//! [`RecvError::Lagged`]: tokio::sync::broadcast::error::RecvError::Lagged

use tokio::sync::broadcast;

use super::{SessionStatus, TerminalId, TerminalSummary};

/// Events buffered for a subscriber before it is considered to have lagged.
///
/// Generous, because the cost of overflowing is a client-side re-`list` of
/// every session: a burst of status transitions across a screenful of busy
/// agents must not cost that, while a client wedged for minutes should not be
/// remembered forever.
pub const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// Something that happened to a session, from the manager's point of view.
///
/// The daemon's transport maps these onto `protocol::Event`; the split is the
/// same one [`super::TerminalMessage`] has against `protocol::StreamFrame`, and
/// keeps the wire module free of this half of the crate.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// A session was accepted into the manager and is now listed. Boxed: a
    /// summary dwarfs every other variant, and this is the rarest of them.
    Started(Box<TerminalSummary>),
    /// A session's status changed — the same object its own subscribers get as
    /// [`super::TerminalMessage::Status`].
    Status(SessionStatus),
    /// A session's PTY was resized. Real changes only, mirroring
    /// [`Session::resize`](super::Session::resize)'s no-op rule.
    Resized {
        id: TerminalId,
        cols: u16,
        rows: u16,
    },
    /// A session was moved to another workspace, or off every workspace.
    WorkspaceAssigned {
        id: TerminalId,
        workspace_id: Option<String>,
    },
    /// A session's child exited. Always paired with a following [`Self::Removed`].
    Exited {
        id: TerminalId,
        exit_code: Option<i32>,
    },
    /// A session is no longer listed.
    Removed { id: TerminalId },
}

/// The publish side of the bus, cloned into every session the manager owns.
#[derive(Clone, Debug)]
pub struct EventBus {
    tx: broadcast::Sender<SessionEvent>,
}

impl EventBus {
    /// A bus holding [`EVENT_CHANNEL_CAPACITY`] events per subscriber.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self { tx }
    }

    /// Publish an event. Having no subscribers is the normal case (a daemon
    /// nobody has opened an events connection to), not a failure.
    ///
    /// It is also the case worth not paying for. A `broadcast` sender keeps
    /// every value it is handed in its ring until the slot is reused, whether
    /// or not anyone ever reads it — so publishing into an unwatched bus is a
    /// clone retained indefinitely for nobody. Returning early instead makes
    /// the unwatched daemon, which is most daemons most of the time, cost
    /// nothing per transition.
    pub fn publish(&self, event: SessionEvent) {
        if !self.has_subscribers() {
            return;
        }
        let _ = self.tx.send(event);
    }

    /// Whether anyone is listening. What a caller checks before *building* an
    /// event — [`Self::publish`] takes an owned one, and a status is a deep
    /// clone.
    pub fn has_subscribers(&self) -> bool {
        self.tx.receiver_count() > 0
    }

    /// Attach a new subscriber. It receives events published from this moment
    /// on — pair it with a `list` taken afterwards to get the invariant.
    pub fn subscribe(&self) -> EventSubscription {
        EventSubscription {
            rx: self.tx.subscribe(),
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

/// A live stream of every session's [`SessionEvent`]s.
///
/// `rx.recv()` yields `Err(RecvError::Lagged(n))` when this subscriber fell
/// behind — resync, don't disconnect — and `Err(RecvError::Closed)` only once
/// the manager itself is gone.
#[derive(Debug)]
pub struct EventSubscription {
    pub rx: broadcast::Receiver<SessionEvent>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast::error::TryRecvError;

    fn removal(id: &str) -> SessionEvent {
        SessionEvent::Removed {
            id: TerminalId::from(id),
        }
    }

    /// Publishing with nobody listening is the ordinary state of a daemon, and
    /// a subscriber only ever hears what happened after it arrived.
    #[test]
    fn a_subscriber_hears_from_the_moment_it_subscribes() {
        let bus = EventBus::new();
        assert!(!bus.has_subscribers(), "a fresh bus is unwatched");
        bus.publish(removal("before"));

        let mut sub = bus.subscribe();
        assert!(bus.has_subscribers());
        bus.publish(removal("after"));

        match sub.rx.try_recv() {
            Ok(SessionEvent::Removed { id }) => assert_eq!(id.0, "after"),
            other => panic!("expected the event published after subscribing: {other:?}"),
        }
        assert!(matches!(sub.rx.try_recv(), Err(TryRecvError::Empty)));
    }

    /// Falling behind costs the events, not the subscription: the channel says
    /// how many were lost and then keeps delivering, which is what lets the
    /// transport answer with a `lagged` frame instead of a disconnect.
    #[test]
    fn overflowing_lags_the_subscriber_and_then_recovers() {
        let bus = EventBus::new();
        let mut sub = bus.subscribe();

        for n in 0..=EVENT_CHANNEL_CAPACITY {
            bus.publish(removal(&format!("t{n}")));
        }

        assert!(
            matches!(sub.rx.try_recv(), Err(TryRecvError::Lagged(_))),
            "an overflowed subscriber must be told it lost events"
        );
        // And it is still a working subscription, positioned at the oldest
        // event still held.
        assert!(
            matches!(sub.rx.try_recv(), Ok(SessionEvent::Removed { .. })),
            "a lagged subscriber must keep receiving"
        );

        bus.publish(removal("later"));
        let mut latest = None;
        while let Ok(event) = sub.rx.try_recv() {
            latest = Some(event);
        }
        match latest {
            Some(SessionEvent::Removed { id }) => assert_eq!(id.0, "later"),
            other => panic!("events published after a lag never arrived: {other:?}"),
        }
    }

    /// The last subscriber leaving puts the bus back to unwatched, which is
    /// what [`EventBus::publish`] checks before retaining anything.
    #[test]
    fn dropping_the_last_subscriber_leaves_the_bus_unwatched() {
        let bus = EventBus::new();
        let sub = bus.subscribe();
        assert!(bus.has_subscribers());
        drop(sub);
        assert!(!bus.has_subscribers());
    }
}
