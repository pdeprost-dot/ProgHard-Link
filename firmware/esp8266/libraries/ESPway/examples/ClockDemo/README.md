# ClockDemo

ClockDemo is a user application for the **Waveshare
ESP32-C6-Touch-LCD-1.47**. It was built and hardware-tested with an ESP32-C6;
the LCD layer is specific to that board and is kept separate from the clock
and ProgHard Link application logic.

The landscape display shows the local time, date and `NTP`/`MANUAL` state.
The `/clock` page is available both on the LAN and through ProgHard Link remote
access. It configures the NTP server and POSIX timezone, requests an immediate
sync, or applies a manual date and time. Mode, server and timezone persist
across reboots.

## Build

- Board: `esp32:esp32:esp32c6` (ESP32C6 Dev Module), Arduino-ESP32 3.3.11
- Flash: 8 MB
- Partition scheme: `default_8MB` (3 MB application / 1.5 MB SPIFFS)
- ProgHard Link library 0.4.11
- Arduino_GFX 1.6.7 (Waveshare still documents 1.5.9, which is not compatible
  with Arduino-ESP32 3.3.11)

The display uses the official Waveshare pin assignment and JD9853
initialization sequence. Touch is intentionally not used.

The default timezone is Belgium with daylight-saving rules:
`CET-1CEST,M3.5.0/2,M10.5.0/3`. Change it on `/clock` for another location.

There is no battery-backed real-time clock on this board. After a complete
power loss, NTP mode synchronizes again automatically; manual mode requires the
user to set the clock again.
