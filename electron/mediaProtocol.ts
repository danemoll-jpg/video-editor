// Phase 6 needs the renderer to actually play video/audio/image files for
// the timeline preview — every prior phase only ever showed metadata about
// an asset, never the file itself. The renderer can't touch the filesystem
// directly (contextIsolation/no nodeIntegration, per CLAUDE.md), and a plain
// `file://` URL risks being treated as a distinct opaque origin per path,
// which would "taint" the `<canvas>` the preview compositor
// (PreviewPlayer.tsx) draws frames onto — silently breaking chroma-key pixel
// processing (getImageData throws once a canvas is tainted).
//
// Instead, this registers a custom `media://` protocol, privileged as a
// standard, secure, CORS-enabled, fetchable scheme (registered before
// app.whenReady, per Electron's requirement) so resources it serves are
// safe to draw into a canvas. `registerMediaProtocolHandler()` (called after
// app.whenReady) resolves a request to an absolute path and hands it to
// `net.fetch` against the equivalent `file://` URL — passing the incoming
// request's headers through is what makes `<video>`/`<audio>` seeking work,
// since Electron's `net.fetch` honors a forwarded `Range` header against a
// local file and returns a proper 206 partial response.
//
// The absolute path is carried as a base64url-encoded path segment
// (`media://local/<encoded>`) rather than attempting to cram a raw Windows
// path (drive letter, backslashes, colon) into a URL — trivial to encode/
// decode correctly, and sidesteps any URL-parsing edge cases entirely.

import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

export const MEDIA_PROTOCOL = 'media'

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

/** Builds the `media://` URL the renderer should use as a src for the given absolute file path. */
export function buildMediaUrl(absolutePath: string): string {
  const encoded = Buffer.from(absolutePath, 'utf-8').toString('base64url')
  return `${MEDIA_PROTOCOL}://local/${encoded}`
}

function decodeMediaUrl(requestUrl: string): string {
  const parsed = new URL(requestUrl)
  const encoded = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  return Buffer.from(encoded, 'base64url').toString('utf-8')
}

/** Call once, after app.whenReady(). */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    try {
      const absolutePath = decodeMediaUrl(request.url)
      return net.fetch(pathToFileURL(absolutePath).toString(), { headers: request.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
