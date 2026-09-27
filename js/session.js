(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.session = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "cecSession";
  const ALL_PAGES = ["dashboard", "students", "payments", "books", "inventory", "issuing", "reports", "settings"];
  const ROLE_PAGES = {
    admin: ["dashboard", "students", "payments", "books", "inventory", "issuing", "reports", "settings"],
    teacher: ["students"],
    storekeeper: ["dashboard", "payments", "inventory", "issuing"]
  };
  const ROLE_DEFAULT = { admin: "dashboard", teacher: "students", storekeeper: "dashboard" };

  let authOffline = false;
  let cached = null;

  function decodeBase64Url(data) {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") return atob(b64);
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
    throw new Error("no base64 decoder available");
  }

  function parsePayload(token) {
    if (typeof token !== "string" || !token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    try {
      const p = JSON.parse(decodeBase64Url(token.slice(0, dot)));
      if (!p || typeof p !== "object" || typeof p.sub !== "string" || typeof p.role !== "string") return null;
      return {
        username: p.sub,
        role: p.role,
        exp: typeof p.exp === "number" ? p.exp : 0
      };
    } catch (e) {
      return null;
    }
  }

  function can(role, page) {
    return (ROLE_PAGES[role] || []).indexOf(page) !== -1;
  }

  function defaultPage(role) {
    return ROLE_DEFAULT[role] || "dashboard";
  }

  function resolvePage(role, hash) {
    const raw = String(hash || "").replace(/^#/, "").toLowerCase();
    const page = ALL_PAGES.indexOf(raw) !== -1 ? raw : "dashboard";
    return can(role, page) ? page : defaultPage(role);
  }

  function load() {
    if (cached) return cached;
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object" || typeof s.token !== "string") return null;
      const payload = parsePayload(s.token);
      if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
        clear();
        return null;
      }
      cached = { token: s.token, username: payload.username, role: payload.role, exp: payload.exp };
      return cached;
    } catch (e) {
      return null;
    }
  }

  function store(token, username, exp) {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem(KEY, JSON.stringify({ token: token, username: username, exp: exp }));
      }
    } catch (ignored) {}
    cached = null;
  }

  function clear() {
    cached = null;
    try {
      if (typeof localStorage !== "undefined" && localStorage) localStorage.removeItem(KEY);
    } catch (ignored) {}
  }

  function redirectLogin() {
    if (typeof location !== "undefined" && String(location.pathname).indexOf("login.html") === -1) {
      location.href = "login.html";
    }
  }

  async function guard() {
    const s = load();
    if (!s) {
      redirectLogin();
      return false;
    }
    try {
      const res = await fetch("api/check", { headers: { Authorization: "Bearer " + s.token } });
      if (res.status === 401) {
        clear();
        redirectLogin();
        return false;
      }
      if (!res.ok) {
        authOffline = true;
        return true;
      }
      const body = await res.json().catch(() => null);
      if (!body || body.ok !== true) {
        clear();
        redirectLogin();
        return false;
      }
      return true;
    } catch (e) {
      authOffline = true;
      return true;
    }
  }

  function logout() {
    clear();
    redirectLogin();
  }

  function isOffline() {
    return authOffline;
  }

  return {
    KEY: KEY,
    parsePayload: parsePayload,
    can: can,
    defaultPage: defaultPage,
    resolvePage: resolvePage,
    load: load,
    store: store,
    clear: clear,
    guard: guard,
    logout: logout,
    isOffline: isOffline
  };
});
