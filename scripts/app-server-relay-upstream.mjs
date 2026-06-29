export function buildUpstreamRequestOptions({ upstreamUnixSocket, upstreamUrl, upstreamToken, websocketKey }) {
  const headers = {
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": websocketKey,
  };

  if (upstreamUnixSocket) {
    // daemon control socket 是本机 Unix socket，不需要 WebSocket bearer token。
    return {
      socketPath: upstreamUnixSocket,
      path: "/",
      headers,
    };
  }

  return {
    host: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: `${upstreamUrl.pathname || "/"}${upstreamUrl.search || ""}`,
    headers: {
      ...headers,
      Authorization: `Bearer ${upstreamToken}`,
    },
  };
}

export function describeUpstream({ upstreamUnixSocket, upstreamUrl }) {
  if (upstreamUnixSocket) {
    return `unix://${upstreamUnixSocket}`;
  }

  return upstreamUrl.toString();
}
