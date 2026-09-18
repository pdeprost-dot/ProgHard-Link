# AI prompt for developing a ProgHard Link application

Copy the prompt below into a new conversation with your development agent, then
fill in only what you know. A one-sentence application description is enough.

```text
Develop a ProgHard Link-compatible application from the official public
repository:

https://github.com/pdeprost-dot/ProgHard-Link

The current repository is the source of truth. Inspect it before proposing or
changing code. Read docs/application-development.md in full, then review
README.md, the current OTA documentation, and the Arduino examples relevant to
the requested target and features. Follow the ProgHard Link application
development contract documented in the repository. Do not rely on an older
copy of the project or assumptions that conflict with the current code.

APPLICATION TO DEVELOP

- Description: [one sentence is enough]
- Board / MCU: [optional]
- Connected hardware: [optional]
- Desired user interface: [optional]
- Application API: [optional]
- MQTT: [optional]
- Persistent settings: [optional]
- Special constraints: [optional]

Work autonomously: inspect, implement, compile, test, fix, and retest. Use the
terminal, browser, and real hardware when your environment supports them. Ask
the user only for genuinely indispensable human actions, and do not ask again
for information already available in the repository or environment.

Reuse the existing ProgHard Link framework and services instead of rebuilding
Wi-Fi, provisioning, device identity, enrollment, the tunnel, HTTP,
authentication, MQTT, persistence, or OTA. Integrate every important
application page into navigation as required by the contract. Use the
documented authentication mechanisms and, when an external client needs remote
API access, the intended PAT flow. The Device Token is an internal secret:
never ask the user for it and never expose it.

Preserve the Device ID, Device Token, Wi-Fi, enrollment, ownership, and
configuration during normal updates. Never perform a full erase merely to
deploy a new application version. Use the current ProgHard Link remote OTA
workflow in Device Manager when available. Keep hardware-specific code
reasonably isolated from application logic. Change the ProgHard Link core or
framework only when a concrete limitation is demonstrated against the current
repository.

Compile and test for the real target. Never claim hardware validation unless
it was actually performed. Be economical with context: read repository files
directly, avoid long progress explanations, and report mainly important
decisions, blockers, and results.

Before considering the work complete:

1. compile the application for its intended target;
2. run the relevant tests and validations;
3. inspect the diff and check for secrets or temporary artifacts;
4. when possible, install the .bin through ProgHard Link OTA without a full
   erase;
5. verify reboot, return to ONLINE, application behavior, and preservation of
   identity, enrollment, and configuration;
6. provide a concise final report listing tests actually run, build sizes, any
   real hardware validation, and remaining limitations.

Do not commit or push anything without the user's explicit authorization.
```
