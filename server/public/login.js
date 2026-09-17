const form = document.querySelector("#login-form");
const error = document.querySelector("#error");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#username").value,
        password: document.querySelector("#password").value,
      }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Try again later." : "Invalid username or password.");
    const next = new URLSearchParams(location.search).get("next");
    location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  } catch (cause) { error.textContent = cause.message; }
});
