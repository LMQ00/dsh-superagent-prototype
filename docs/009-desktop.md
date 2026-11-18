# 009 Desktop

DeepSeek Harness Desktop runs the same Web application as `dsh web` from its own profile, inside an application window. The Superagent panel opens in that window, in the sidebar, next to the other panels.

This document covers the differences from the CLI profile installation of [006 Deployment](006-deployment.md): who owns the profile and the Host, how to install the bundle there, and how to reach the management API.

## What the application owns

| Owner | Owns |
| --- | --- |
| The application | The `desktop` profile at `$DSH_HOME/profiles/desktop`, the packages and enabled bundles in it, and the Host process that loads them |
| dsh-superagent | Everything inside its state directory: the database, the worker environment, and the Ticket directories |

The application starts the Host when it starts, and stops the Host when it quits. Closing the window keeps both running. A quit ends running Executor Sessions the way any host restart does, and their Assignments resume with recovery notes on the next start ([003 Execution](003-execution.md#restart)).

`scripts/dsh-superagent` manages a CLI profile in tmux. It refuses `desktop`, because the application starts and stops that Host itself.

The Host listens on a port the application picks at each start. The panel reaches it through the application, so a person needs no URL. A terminal that calls the management API needs a fixed port, as below.

The steps here are for the macOS application. The worker environment dsh-superagent writes is POSIX: `stateDir` is a POSIX absolute path, and the command shims are shell scripts.

## Install

1. Launch the application once and quit it fully. The first launch creates `$DSH_HOME/profiles/desktop`.
2. Build the checkout and install it into that profile with the `dsh` command the application installs (**Manage dsh Command…**):

   ```sh
   cd <checkout>
   pnpm install && pnpm build
   dsh plugin --profile desktop add "link:$PWD"
   ```

   A `dsh` installed from npm cannot change this profile. When both are on `PATH`, run the application's command, or put it first.

3. Add the state directory to the profile's patch file, `$DSH_HOME/profiles/desktop/cordis.patch.yml`:

   ```yaml
   - id: dsh-superagent
     config:
       stateDir: <absolute path>
   ```

   An existing installation's state directory keeps its Tickets, settings and prompt history; a new directory starts empty.

4. Open the application. **Superagent** in the sidebar opens the panel. Overview lists what setup still needs, and the Settings pages work as in [006 Deployment](006-deployment.md).

The install command also enables the bundle. `dsh plugin --profile desktop remove dsh-superagent` disables it again.

## State and environment

One Host at a time uses a state directory. The state directory's lock is taken by whichever Host opens it, so stop the CLI profile's service before starting the application with the same directory, and the other way round. A second Host runs without the panel: dsh-superagent cannot open the directory and fails to load, and the log names the lock.

Setup works as it does in a CLI profile: it verifies the repository and the agent's CLIs, writes the command shims and the git configuration into the state directory, and puts the shim directory first on the process `PATH`. The application's own Sessions run in the same process and see the same `PATH` and git configuration.

The application passes the account's environment to its Host, so a CLI on `PATH` in a terminal is found here too. A CLI outside `PATH` goes into the Source settings as an absolute path.

A setup check or an account change restarts dsh-superagent inside the running application. The application and its other Sessions stay up.

## Management API

The panel calls `/orchestrator/api/` in the application window, with the same routes and the same `x-orchestrator-request: 1` header as [006 Deployment](006-deployment.md#management-api).

To call those routes from a terminal, pin the port in the same profile patch file:

```yaml
- id: webserver
  config:
    port: 3082
```

Then this answers while the application runs:

```sh
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/orchestrator/api/state
```

## Upgrade

1. Wait until no Executor is in the middle of a turn; Overview shows the running Tickets.
2. Back up `<stateDir>/orchestrator.sqlite`.
3. Run `git pull && pnpm install && pnpm build` in the checkout.
4. Quit the application and open it again. The profile links to the checkout, so the new build loads.

Updating the application installs a new DeepSeek Harness runtime. dsh-superagent loads only within the `engines.dsh` range of its `package.json`; for a runtime outside that range, install a dsh-superagent version whose range includes it.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **Superagent** is missing from the sidebar | The bundle is not in `dsh.profile.bundles` of `$DSH_HOME/profiles/desktop/package.json`, or it failed to load; the application's Plugins page and log name which |
| The log says the configuration needs `stateDir` | Add the entry of Install step 3 and open the application again |
| **Superagent** is missing from the sidebar, and the log says the state directory's lock is held | Another Host uses the same state directory; stop the CLI profile's service, or give this installation a directory of its own |
| `dsh plugin --profile desktop` reports that the profile is reserved | An npm-installed `dsh` cannot manage this profile; run the command the application installs |
| Setup cannot find `gh` | Set the agent CLI's absolute path on the GitHub Source card |
| The panel shows "Failed to load plugins" after the application updates | Quit the application and open it again, then reload |
