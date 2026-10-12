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

Your data stays on your own computer. Nothing is uploaded anywhere.

## Building

- Mac: `./build.sh` (needs the Swift toolchain), then `ditto -c -k --keepParent TimePie.app TimePie-Mac.zip`
- Windows (builds fine on a Mac): `cd windows && ./build-windows.sh`, giving `windows/dist/TimePie-Windows.zip`
