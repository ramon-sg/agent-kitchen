// A fake npm registry for the tests, run as a child process by helpers.mjs (once per test
// file): it listens on a free port, prints the port, and answers `GET /<repo id>/<package>`
// with a packument built from <root>/<repo id>/registry.json, which holds what a test gave
// as FAKE_NPM ({ "<package>": "<latest version>" }), FAKE_NPM_DEPS
// ({ "<package>@<version>": { "<dependency>": "<range>" } }) and FAKE_NPM_VERSIONS
// ({ "<package>": ["<version>", ...] }). A package's versions are those, the ones with
// dependencies and its latest. 404 if the package is not there.
// It exits when its parent closes its stdin.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const root = process.argv[2];

const answer = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const server = createServer((request, response) => {
  try {
    const [id, name, ...more] = (request.url ?? "").split("?")[0].split("/").filter(Boolean);
    if (id === undefined || id.includes("..") || name === undefined || more.length > 0) return answer(response, 404, { error: "not found" });
    const { latest = {}, deps = {}, versions: listed = {} } = JSON.parse(readFileSync(join(root, id, "registry.json"), "utf8"));
    const pkg = decodeURIComponent(name);
    const versions = {};
    for (const version of [...(listed[pkg] ?? []), ...(latest[pkg] === undefined ? [] : [latest[pkg]])]) versions[version] = { name: pkg, version };
    for (const [spec, dependencies] of Object.entries(deps)) {
      const at = spec.lastIndexOf("@");
      if (at > 0 && spec.slice(0, at) === pkg) versions[spec.slice(at + 1)] = { name: pkg, version: spec.slice(at + 1), dependencies };
    }
    if (latest[pkg] === undefined && Object.keys(versions).length === 0) return answer(response, 404, { error: "not found" });
    answer(response, 200, { name: pkg, "dist-tags": latest[pkg] === undefined ? {} : { latest: latest[pkg] }, versions });
  } catch {
    answer(response, 404, { error: "not found" });
  }
});

server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
