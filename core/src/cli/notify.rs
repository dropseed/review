//! `spur notify` — send a web push notification to every device subscribed
//! through the app (Settings → Push notifications).
//!
//! The app's own pushes are gated on the human being away from the machine
//! (see the desktop `notifications` module); this one is not. A CLI send is an
//! explicit act, so it goes out whether or not anyone is at the keyboard.

use clap::Args;

use crate::push::{self, NotificationPayload};

use super::common::{block_on, print_json};

#[derive(Debug, Args)]
pub struct NotifyArgs {
    /// Notification title
    pub title: String,

    /// Notification body (defaults to empty)
    #[arg(short, long, default_value = "")]
    pub body: String,

    /// URL to open when the notification is tapped (a `spur://` link or a
    /// path on the served app, e.g. `/`)
    #[arg(short, long)]
    pub url: Option<String>,

    /// Tag: a later notification with the same tag replaces this one on the
    /// device instead of stacking
    #[arg(short, long)]
    pub tag: Option<String>,

    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// Exits non-zero when nothing was delivered. With `--json` the report is the
/// whole output either way; without it, the failure is the error line alone.
pub fn run_notify(args: NotifyArgs) -> Result<(), String> {
    let payload = NotificationPayload {
        title: args.title,
        body: args.body,
        url: args.url,
        tag: args.tag,
    };
    let report = block_on(push::send_to_all(&payload))?.map_err(|e| e.to_string())?;

    if args.json {
        print_json(&report);
        if report.sent == 0 {
            std::process::exit(1);
        }
        return Ok(());
    }

    if report.subscriptions == 0 {
        return Err(
            "No devices are subscribed. Enable Remote access, open the app on your phone, \
                    and turn on Settings → Push notifications."
                .to_owned(),
        );
    }
    if report.sent == 0 {
        return Err(format!(
            "Nothing was delivered: {} failed, {} expired and removed.",
            report.failed, report.pruned
        ));
    }
    let mut line = format!(
        "Sent to {} of {} device(s)",
        report.sent, report.subscriptions
    );
    if report.failed > 0 {
        line.push_str(&format!(", {} failed", report.failed));
    }
    if report.pruned > 0 {
        line.push_str(&format!(", {} expired and removed", report.pruned));
    }
    println!("{line}.");
    Ok(())
}
