//! The batteries this Mac can see — its own, and the accessories on its desk.
//!
//! A phone looking at Spur over the tailnet is looking at a machine it is not
//! sitting in front of, and the one fact that machine's menu bar was answering
//! all along is how much longer it has. A laptop that sleeps takes every agent
//! session with it, so "62%, three hours left" is the difference between
//! sending one more prompt and walking back to the desk.
//!
//! Two readers, because macOS keeps the two kinds of battery in different
//! places and neither knows about the other:
//!
//! * **The Mac's own** comes from `pmset -g batt`, which states the charge, what
//!   the battery is doing, and macOS's own time estimate — including the
//!   estimate's absence, which is a real state for the first minutes after a
//!   cable moves and must not be rendered as "0 minutes left".
//! * **Accessories** (Magic Keyboard, Mouse, Trackpad) report a `BatteryPercent`
//!   into the IORegistry, which `ioreg -r -k BatteryPercent` prints. They have
//!   no charge state there at all, so they carry a percentage and nothing else.
//!
//! Everything here is macOS-only and deliberately infallible: a Mac mini has no
//! internal battery, a Linux box has neither binary, and a `pmset` that fails is
//! indistinguishable from either. All three are the same answer — *no batteries*
//! — which the caller renders by showing nothing. There is no error here a
//! reader could act on, so none is raised.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// What a battery is doing right now.
///
/// `PluggedNotCharging` is macOS's optimized charging holding at a level on
/// purpose — a state that reads as broken if it is collapsed into `Charging`
/// (the number never moves) or into `Charged` (it says 80%).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BatteryState {
    Charging,
    Discharging,
    Charged,
    PluggedNotCharging,
    Unknown,
}

/// One battery, as this Mac reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    /// Stable across polls, so a list can be keyed on it. The internal battery
    /// is always `internal`; an accessory is its product name, which is what
    /// distinguishes two of them.
    pub id: String,
    /// What to call it on screen — the accessory's own product name, or the
    /// plain word for the machine's own cell.
    pub name: String,
    pub percent: u8,
    pub state: BatteryState,
    /// Minutes until empty (discharging) or full (charging), when macOS has an
    /// estimate. `None` is "still calculating", which is what it says for the
    /// first few minutes after a cable moves — a different thing from zero.
    pub minutes_remaining: Option<u32>,
    /// The Mac's own cell, as opposed to something on its desk. It is the one
    /// that decides whether the sessions survive, so it sorts first and is the
    /// one a caller with room for a single number should show.
    pub internal: bool,
}

/// Coalescing window for repeat reads.
///
/// Both subprocesses are cheap (tens of milliseconds), so this is not about
/// cost — it is about a percentage that moves once every few minutes being
/// asked for by a phone, a laptop and a desktop at once. Well under the
/// caller's poll interval, so a scheduled poll always reads the machine.
const CACHE_TTL: Duration = Duration::from_secs(20);

/// Ceiling on either subprocess. Both normally return in tens of milliseconds;
/// past this they are wedged, not slow, and a battery reading is never worth
/// holding a request open for.
const TIMEOUT: Duration = Duration::from_secs(5);

type Cache = Mutex<Option<(Instant, Vec<Battery>)>>;
static CACHE: OnceLock<Cache> = OnceLock::new();

/// Every battery this machine can see, internal first, cached for [`CACHE_TTL`].
///
/// Empty means there is nothing to show — no internal battery, no accessories
/// reporting one, or not a Mac. A caller renders what it gets and never has to
/// decide whether a machine is the kind that has a battery.
pub fn report() -> Vec<Battery> {
    if let Some(cached) = fresh_enough() {
        return cached;
    }

    let batteries = read();
    *lock(CACHE.get_or_init(|| Mutex::new(None))) = Some((Instant::now(), batteries.clone()));
    batteries
}

fn fresh_enough() -> Option<Vec<Battery>> {
    let cache = lock(CACHE.get_or_init(|| Mutex::new(None)));
    let (cached_at, batteries) = cache.as_ref()?;
    (cached_at.elapsed() < CACHE_TTL).then(|| batteries.clone())
}

/// A poisoned lock here means a previous reader panicked mid-read. The value
/// behind it is a cached percentage, so the recovery is to carry on with it.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(target_os = "macos")]
fn read() -> Vec<Battery> {
    let mut batteries = Vec::new();
    if let Some(internal) = run("pmset", &["-g", "batt"])
        .as_deref()
        .and_then(parse_pmset)
    {
        batteries.push(internal);
    }
    if let Some(out) = run("ioreg", &["-r", "-k", "BatteryPercent", "-l"]) {
        batteries.extend(parse_ioreg(&out));
    }
    batteries
}

/// Nothing to read: `pmset` and `ioreg` are macOS binaries, and there is no
/// portable stand-in worth the guesswork.
#[cfg(not(target_os = "macos"))]
fn read() -> Vec<Battery> {
    Vec::new()
}

/// A command's stdout, or `None` for anything that went wrong — a missing
/// binary, a non-zero exit, a hang. All of them mean the same thing here.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    let output = crate::process::output_with_timeout(&mut cmd, TIMEOUT).ok()??;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The internal battery out of `pmset -g batt`.
///
/// The line it reads looks like
///
/// ```text
///  -InternalBattery-0 (id=12582499)	62%; discharging; 3:24 remaining present: true
/// ```
///
/// and is semicolon-delimited after the percentage: charge, state, then an
/// estimate that is variously `3:24 remaining`, `(no estimate)`, or absent. A
/// desktop Mac prints the `Now drawing from 'AC Power'` header and no such line
/// at all, which is why this returns an `Option` rather than a default.
pub fn parse_pmset(output: &str) -> Option<Battery> {
    let line = output
        .lines()
        .find(|line| line.trim_start().starts_with("-InternalBattery"))?;
    let mut fields = line.split(';').map(str::trim);

    // The percentage is the tail of the first field, past the id in parens.
    let percent = fields
        .next()?
        .rsplit(|c: char| c.is_whitespace())
        .find_map(|word| word.strip_suffix('%'))
        .and_then(|n| n.parse::<u8>().ok())?;

    let state = fields
        .next()
        .map(parse_state)
        .unwrap_or(BatteryState::Unknown);
    // The estimate carries `present: true` on the same field. Parsing the
    // clock off the front rather than matching the whole field means that
    // trailing text — which has changed across macOS releases — cannot cost us
    // the number in front of it.
    let minutes_remaining = fields.next().and_then(parse_minutes);

    Some(Battery {
        id: "internal".to_string(),
        name: "Mac".to_string(),
        percent: percent.min(100),
        state,
        minutes_remaining,
        internal: true,
    })
}

/// `pmset`'s state wording, which is a phrase rather than a token.
///
/// Order matters: "discharging" contains "charging", so the negative case has
/// to be asked first — and the same trap sits under "not charging", which is
/// macOS holding a plugged-in battery at a level on purpose.
fn parse_state(field: &str) -> BatteryState {
    let field = field.to_ascii_lowercase();
    if field.contains("discharging") {
        BatteryState::Discharging
    } else if field.contains("not charging") {
        BatteryState::PluggedNotCharging
    } else if field.contains("charged") {
        BatteryState::Charged
    } else if field.contains("charging") || field.contains("finishing charge") {
        BatteryState::Charging
    } else if field.contains("ac attached") {
        BatteryState::PluggedNotCharging
    } else {
        BatteryState::Unknown
    }
}

/// `H:MM` off the front of the estimate field, in minutes.
///
/// `(no estimate)` and a `0:00` that only ever accompanies a battery that is
/// full or idle both come back as `None`: neither is a countdown, and rendering
/// either as "0 minutes left" would be an alarm about nothing.
fn parse_minutes(field: &str) -> Option<u32> {
    let clock = field.split_whitespace().next()?;
    let (hours, minutes) = clock.split_once(':')?;
    let total = hours.parse::<u32>().ok()? * 60 + minutes.parse::<u32>().ok()?;
    (total > 0).then_some(total)
}

/// Accessories out of `ioreg -r -k BatteryPercent -l`.
///
/// `ioreg` prints one object per `+-o` line followed by its property table, so
/// the parse is: start a device at each `+-o`, collect the two properties worth
/// having, and emit it when both arrived. A device that reports a percentage but
/// no product name is unnameable and therefore unshowable, so it is dropped
/// rather than listed as something blank.
///
/// One keyboard can be several objects — the HID service and the Bluetooth
/// device both carry a level — so the first reading of a name wins and the rest
/// are dropped. Two devices genuinely sharing a product name are
/// indistinguishable to anyone reading the list anyway.
pub fn parse_ioreg(output: &str) -> Vec<Battery> {
    let mut batteries = Vec::new();
    let mut name: Option<String> = None;
    let mut percent: Option<u8> = None;

    let mut flush = |name: &mut Option<String>, percent: &mut Option<u8>| {
        if let (Some(name), Some(percent)) = (name.take(), percent.take()) {
            if batteries.iter().any(|b: &Battery| b.id == name) {
                return;
            }
            batteries.push(Battery {
                id: name.clone(),
                name,
                percent: percent.min(100),
                // The IORegistry says nothing about whether a mouse on its
                // charging cable is taking power, so neither do we.
                state: BatteryState::Unknown,
                minutes_remaining: None,
                internal: false,
            });
        }
    };

    for line in output.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("+-o") {
            flush(&mut name, &mut percent);
            continue;
        }
        if let Some(value) = property(trimmed, "BatteryPercent") {
            percent = value.trim().parse::<u8>().ok();
        } else if let Some(value) = property(trimmed, "Product") {
            name = Some(value.trim().trim_matches('"').to_string()).filter(|n| !n.is_empty());
        }
    }
    flush(&mut name, &mut percent);

    batteries
}

/// The value half of an `ioreg` property line — `"Key" = value` — for one key.
fn property<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.strip_prefix(&format!("\"{key}\""))?
        .trim_start()
        .strip_prefix('=')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A laptop on battery power, which is the case the whole feature exists for.
    #[test]
    fn a_discharging_laptop_reports_its_charge_and_time_left() {
        let output = "Now drawing from 'Battery Power'\n \
                      -InternalBattery-0 (id=12582499)\t62%; discharging; 3:24 remaining present: true\n";
        let battery = parse_pmset(output).expect("a laptop has an internal battery");
        assert_eq!(battery.percent, 62);
        assert_eq!(battery.state, BatteryState::Discharging);
        assert_eq!(battery.minutes_remaining, Some(204));
        assert!(battery.internal);
    }

    #[test]
    fn a_charging_laptop_says_so() {
        let output = "Now drawing from 'AC Power'\n \
                      -InternalBattery-0 (id=12582499)\t45%; charging; 1:05 remaining present: true\n";
        let battery = parse_pmset(output).unwrap();
        assert_eq!(battery.state, BatteryState::Charging);
        assert_eq!(battery.minutes_remaining, Some(65));
    }

    /// "discharging" contains "charging", so a naive substring test on the
    /// state field reports a draining battery as a filling one — the one wrong
    /// answer here that would send someone away from their desk.
    #[test]
    fn discharging_is_not_read_as_charging() {
        assert_eq!(parse_state("discharging"), BatteryState::Discharging);
        assert_eq!(parse_state("charging"), BatteryState::Charging);
    }

    /// Optimized charging holds a plugged-in Mac at a level on purpose. It is
    /// neither charging (the number never moves) nor charged (it says 80%).
    #[test]
    fn a_plugged_in_battery_being_held_is_its_own_state() {
        let output =
            " -InternalBattery-0 (id=12582499)\t80%; AC attached; not charging present: true\n";
        let battery = parse_pmset(output).unwrap();
        assert_eq!(battery.percent, 80);
        assert_eq!(battery.state, BatteryState::PluggedNotCharging);
    }

    #[test]
    fn a_full_battery_reports_no_countdown() {
        let output = "Now drawing from 'AC Power'\n \
                      -InternalBattery-0 (id=12582499)\t100%; charged; 0:00 remaining present: true\n";
        let battery = parse_pmset(output).unwrap();
        assert_eq!(battery.state, BatteryState::Charged);
        assert_eq!(
            battery.minutes_remaining, None,
            "0:00 on a full battery is not a countdown to anything"
        );
    }

    /// macOS says this for the first minutes after a cable moves. It is a real
    /// state, and rendering it as zero would be an alarm about nothing.
    #[test]
    fn an_absent_estimate_is_none_rather_than_zero() {
        let output =
            " -InternalBattery-0 (id=12582499)\t73%; discharging; (no estimate) present: true\n";
        let battery = parse_pmset(output).unwrap();
        assert_eq!(battery.percent, 73);
        assert_eq!(battery.minutes_remaining, None);
    }

    /// A desktop Mac prints the header and nothing else. No battery is the
    /// honest answer, not a battery at zero.
    #[test]
    fn a_mac_with_no_internal_battery_reports_none() {
        assert!(parse_pmset("Now drawing from 'AC Power'\n").is_none());
        assert!(parse_pmset("").is_none());
    }

    #[test]
    fn accessories_come_back_named_with_their_charge() {
        let output = r#"
+-o AppleDeviceManagementHIDEventService  <class AppleDeviceManagementHIDEventService, id 0x100000d3f, registered, matched, active, busy 0 (0 ms), retain 8>
  {
    "BatteryPercent" = 88
    "Product" = "Magic Keyboard with Touch ID"
    "Transport" = "Bluetooth"
  }
+-o AppleDeviceManagementHIDEventService  <class AppleDeviceManagementHIDEventService, id 0x100000d40, registered, matched, active, busy 0 (0 ms), retain 8>
  {
    "Product" = "Magic Trackpad"
    "BatteryPercent" = 41
  }
"#;
        let batteries = parse_ioreg(output);
        assert_eq!(batteries.len(), 2);
        assert_eq!(batteries[0].name, "Magic Keyboard with Touch ID");
        assert_eq!(batteries[0].percent, 88);
        assert!(!batteries[0].internal);
        assert_eq!(batteries[1].name, "Magic Trackpad");
        assert_eq!(batteries[1].percent, 41);
    }

    /// Properties belong to the object they were printed under. Without the
    /// `+-o` boundary a nameless device would inherit the previous device's
    /// name and be listed twice at two different charges.
    #[test]
    fn a_device_with_no_name_is_dropped_rather_than_borrowing_the_last_one() {
        let output = r#"
+-o Named  <class X>
  {
    "Product" = "Magic Mouse"
    "BatteryPercent" = 50
  }
+-o Nameless  <class X>
  {
    "BatteryPercent" = 12
  }
"#;
        let batteries = parse_ioreg(output);
        assert_eq!(batteries.len(), 1);
        assert_eq!(batteries[0].name, "Magic Mouse");
    }

    /// A keyboard shows up as both an HID service and a Bluetooth device, each
    /// carrying the same level. Two rows for one keyboard is wrong on screen,
    /// and a duplicate key is wrong in React.
    #[test]
    fn one_device_reported_twice_is_listed_once() {
        let output = r#"
+-o AppleDeviceManagementHIDEventService  <class X>
  {
    "Product" = "Magic Keyboard"
    "BatteryPercent" = 88
  }
+-o BluetoothDevice  <class Y>
  {
    "Product" = "Magic Keyboard"
    "BatteryPercent" = 88
  }
"#;
        let batteries = parse_ioreg(output);
        assert_eq!(batteries.len(), 1);
        assert_eq!(batteries[0].name, "Magic Keyboard");
    }

    #[test]
    fn no_accessories_is_an_empty_list_not_a_parse_failure() {
        assert!(parse_ioreg("").is_empty());
    }

    /// The service is called on every poll from every attached client, on
    /// machines that have no batteries at all. It must answer rather than fail.
    #[test]
    fn report_answers_on_any_platform() {
        let batteries = report();
        for battery in &batteries {
            assert!(battery.percent <= 100);
            assert!(!battery.id.is_empty());
        }
    }
}
