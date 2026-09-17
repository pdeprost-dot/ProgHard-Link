# Remote device access

Use the authenticated path:

```text
Device Manager → My devices → Open
```

The Device Manager requests a short-lived, single-use access ticket and submits
it to the selected device hostname. The server consumes the ticket, creates a
device-session cookie limited to that hostname, and redirects to the ESP UI.
The administrator's cookie is not shared with wildcard device hosts.

Opening `https://esp-xxxxxx.link.example.com/` directly in a browser without
this authorization may return:

```text
401 authentication required
```

That is intentional, not evidence that the tunnel is broken. Return to the
Device Manager and use **Open**. A disconnected device instead produces an
offline response after authorization.

The browser connection is HTTPS. The ESP maintains an outbound HTTP WebSocket
to `http://tunnel.link.example.com/tunnel` using `espway-tunnel/2`; device
authentication and protected frames are handled by that protocol.
