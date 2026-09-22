"use strict";
const ORIGIN = "https://speckrmm.com";
function trusted(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}
function destination(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "speck:" ||
      url.hostname !== "connect" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    const id = url.pathname.slice(1);
    return /^[a-f0-9]{32}$/.test(id) ? ORIGIN + "/#remote/" + id : null;
  } catch {
    return null;
  }
}
function remotePage(url) {
  try {
    return trusted(url) && /^#remote\/[a-f0-9]{32}$/.test(new URL(url).hash);
  } catch {
    return false;
  }
}
module.exports = { ORIGIN, trusted, destination, remotePage };
