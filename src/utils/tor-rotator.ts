import net from "net";

const TOR_CONTROL_PORTS: Record<string, number> = {
  "9150": 9151,
  "9152": 9153,
  "9154": 9155,
};

/**
 * Sends SIGNAL NEWNYM to Tor ControlPort to acquire a fresh circuit and IP.
 * Used automatically on TMD/WAF challenges or network timeouts.
 */
export async function rotateTorCircuitForProxy(
  proxyUrl?: string,
): Promise<boolean> {
  if (!proxyUrl) return false;
  const match = proxyUrl.match(/:(\d+)$/);
  if (!match) return false;
  const socksPort = match[1];
  const controlPort = TOR_CONTROL_PORTS[socksPort];
  if (!controlPort) return false;

  return new Promise((resolve) => {
    try {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port: controlPort,
        timeout: 3000,
      });

      socket.on("connect", () => {
        socket.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
      });

      socket.on("data", (data) => {
        if (data.toString().includes("250 OK")) {
          console.log(
            `[TorRotator] Tor circuit refreshed for socksPort ${socksPort} via controlPort ${controlPort}`,
          );
          socket.end();
          resolve(true);
        }
      });

      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}
