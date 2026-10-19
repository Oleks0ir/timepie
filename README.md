# TimePie

A weekly time donut: log how long you spend on each activity and see the week as a pie.

## Download

Grab the latest build from the [Releases page](../../releases/latest):

- **Mac (Apple Silicon):** `TimePie-Mac.zip`. Unzip it and move `TimePie.app` to Applications.
- **Windows:** `TimePie-Windows.zip`. Unzip it and run `TimePie\TimePie.exe`.

### "Can't be opened" / "Windows protected your PC"

The app isn't signed with a paid developer certificate, so both systems warn the first time.

- **Mac:** try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** click **More info → Run anyway**.

Your data stays on your own computer. Nothing is uploaded unless you join a friends group (below).

## Friends

Click the **people button** at the top right to compare weeks with friends. One person clicks **Start a Group** and sends the six-character code (like `ABC-DEF`) to the others, who paste it in and click **Join**. No accounts or passwords.

The leaderboard ranks everyone by hours logged in the week you're viewing, and the arrows step through weeks as usual. Click a person to see their donut. **Open in Browser** shows the same leaderboard as a web page you can check from your phone.

You can be in several groups at once. **Add Group** starts or joins another one, and the switcher at the top flips between them. Give each a **Group name** (only you see it) to tell them apart. Your name and **Hide my activity names** are set per group, so you can share activity names with close friends and only the coloured slices elsewhere.

What's shared: your display name and, for each of the last 12 weeks, your total and the hours per activity. Your individual entries are never shared. **Leave Group** removes you from the leaderboard of the group on screen.

## Building

- Mac: `./build.sh` (needs the Swift toolchain), then `ditto -c -k --keepParent TimePie.app TimePie-Mac.zip`
- Windows (builds fine on a Mac): `cd windows && ./build-windows.sh`, giving `windows/dist/TimePie-Windows.zip`
- Friends server (a Cloudflare Worker with a D1 database): `cd server && npx wrangler deploy`. The tables are in `server/schema.sql`.
