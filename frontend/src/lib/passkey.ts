/** WebAuthn glue: the server sends JSON options with base64url fields; the browser wants ArrayBuffers. */

const toBuffer = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer
}
const toBase64url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createPasskey(options: any) {
  const publicKey = {
    ...options,
    challenge: toBuffer(options.challenge),
    user: { ...options.user, id: toBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((c: { id: string }) => ({ ...c, id: toBuffer(c.id) })),
  }
  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id, rawId: toBase64url(credential.rawId), type: credential.type,
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: {},
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertPasskey(options: any) {
  const publicKey = {
    ...options,
    challenge: toBuffer(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((c: { id: string }) => ({ ...c, id: toBuffer(c.id) })),
  }
  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id, rawId: toBase64url(credential.rawId), type: credential.type,
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
      userHandle: response.userHandle ? toBase64url(response.userHandle) : null,
    },
    clientExtensionResults: {},
  }
}
