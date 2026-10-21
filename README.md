# TimePie

A weekly time donut: log how long you spend on each activity and see the week as a pie.

## Download

Grab the latest build from the [Releases page](../../releases/latest):

- **Mac (Apple Silicon):** `TimePie-Mac.pkg`. Open it and follow the installer, which puts TimePie in Applications.
- **Windows:** `TimePie-Windows-Setup.exe`. Run it and follow the wizard: pick a folder (your own user folder by default, no admin rights needed) and it adds Start menu and desktop shortcuts. Uninstall from **Settings → Apps**.

Installing a new version replaces the old one but keeps everything you've logged, and so does uninstalling. On Windows, if you used an older unzipped copy, delete its folder after installing.

### "Can't be opened" / "Windows protected your PC"

The installers aren't signed with a paid developer certificate, so both systems warn the first time.

- **Mac:** try to open the installer once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** click **More info → Run anyway**.

Your data stays on your own computer. Nothing is uploaded unless you join a friends group (below).

## Friends

Click the **people button** at the top right to compare weeks with friends. One person clicks **Start a Group** and sends the six-character code (like `ABC-DEF`) to the others, who paste it in and click **Join**. No accounts or passwords.

The leaderboard ranks everyone by hours logged in the week you're viewing, and the arrows step through weeks as usual. Click a person to see their donut. **Open in Browser** shows the same leaderboard as a web page you can check from your phone.

You can be in several groups at once. **Add Group** starts or joins another one, and the switcher at the top flips between them. Anyone in a group can give it a **Group name**, which everyone in it sees, on the web page too. Clear the name to show the code again. Your name and **Hide my activity names** are set per group, so you can share activity names with close friends and only the coloured slices elsewhere.

What's shared: the group's name, your display name and, for each of the last 12 weeks, your total and the hours per activity. Your individual entries are never shared. **Leave Group** removes you from the leaderboard of the group on screen.

## Building

Publishing a GitHub release builds both installers and attaches them to it (`.github/workflows/release.yml`). To build by hand:

- Mac: `./build.sh` (needs the Swift toolchain), giving `TimePie.app` and the installer `TimePie-Mac.pkg`
- Windows: `cd windows && ./build-windows.sh` (Git Bash on Windows), giving `windows/dist/TimePie-Windows-Setup.exe`
- Friends server (a Cloudflare Worker with a D1 database): `cd server && npx wrangler deploy`. The tables are in `server/schema.sql`.
