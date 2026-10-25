# Cockpit Caddy

Cockpit interface for managing Caddy reverse proxy and static site routes.

## Install on Debian or Ubuntu

Download `cockpit-caddy_<version>_all.deb` from the
[GitHub Releases](https://github.com/Gustiana882/cockpit-caddy/releases) page,
then install it with:

```sh
sudo apt install ./cockpit-caddy_<version>_all.deb
```

The package installs the Cockpit application under `/usr/share/cockpit/caddy`
and depends on `cockpit-bridge`. Open Cockpit and select **Caddy Proxy** (or
visit `/caddy`). Caddy must be running with its administration API available
at `127.0.0.1:2019`.

To remove it:

```sh
sudo apt remove cockpit-caddy
```

## Build from source

Install the build dependencies on Debian/Ubuntu:

```sh
sudo apt install gettext nodejs npm make dpkg
```

Build the Cockpit application:

```sh
git clone https://github.com/Gustiana882/cockpit-caddy.git
cd cockpit-caddy
make
```

To build a Debian package locally:

```sh
sh packaging/debian/build-deb 1.0.0
```

The version argument should match the release tag you plan to publish. The
resulting `.deb` is written to the repository root.

For local development, install the build output as a user-local Cockpit
package:

```sh
mkdir -p ~/.local/share/cockpit
ln -s "$(pwd)/dist" ~/.local/share/cockpit/caddy
```

After changing the code, run `make` again and reload Cockpit.

## Publish a release

Create and push a version tag (for example, `1.0.0`). GitHub Actions builds a
source archive and a Debian package and attaches both to the GitHub Release:

```sh
git tag -a 1.0.0 -m "Release 1.0.0"
git push origin 1.0.0
```

For development commands and tests, see the Cockpit
[deployment and developer documentation](https://cockpit-project.org/guide/latest/).
