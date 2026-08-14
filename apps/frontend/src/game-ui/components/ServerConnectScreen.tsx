/**
 * Desktop-only server address entry.
 *
 * The Steam shell starts here before it knows which self-hosted Open Clocktower
 * server should own the session. After a successful connection, Electron keeps
 * the bundled UI and the normal setup screen takes over.
 */

type ServerConnectScreenProps = {
  isConnecting: boolean;
  onConnect: () => void;
  onServerUrlChange: (serverUrl: string) => void;
  serverUrl: string;
};

const deploymentDocsUrl = 'https://github.com/Willi-28/open-clocktower/blob/master/docs/deployment.md';

/** Render the single-address-bar entry screen for the desktop shell. */
export function ServerConnectScreen({
  isConnecting,
  onConnect,
  onServerUrlChange,
  serverUrl,
}: ServerConnectScreenProps) {
  return (
    <section className="server-connect-screen">
      <div className="server-connect-content">
        <form
          className="server-address-bar"
          onSubmit={(event) => {
            event.preventDefault();
            onConnect();
          }}
        >
          <input
            aria-describedby="server-connect-help-text"
            aria-label="Server address"
            autoFocus
            placeholder="https://your-open-clocktower-server.example"
            value={serverUrl}
            onChange={(event) => onServerUrlChange(event.target.value)}
          />
          <button disabled={isConnecting || !serverUrl.trim()} type="submit">
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>
        <aside className="server-connect-help" aria-labelledby="server-connect-help-title">
          <strong id="server-connect-help-title">Need a server?</strong>
          <p id="server-connect-help-text">
            The desktop app connects to an existing self-hosted Open Clocktower server. If your group does not have one yet,
            deploy the Docker server first and paste its public HTTPS address here.
          </p>
          <a href={deploymentDocsUrl} target="_blank" rel="noreferrer">
            Open self-hosting documentation
          </a>
        </aside>
      </div>
    </section>
  );
}
