import { issueAccessToken, requireScopes, TokenVerificationError, verifyAccessToken } from "../../src/auth/jwt.js";

const secret = new TextEncoder().encode("test-secret-with-at-least-32-bytes!");

describe("OAuth access token utilities", () => {
  test("issues and verifies a local JWT access token", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read", "clockify:write"],
      expiresIn: "5m"
    });

    const payload = await verifyAccessToken(token, {
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp"
    });

    expect(payload).toMatchObject({
      iss: "https://clockify-mcp.local",
      aud: "clockify-mcp",
      sub: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read", "clockify:write"]
    });
    expect(payload.exp).toEqual(expect.any(Number));
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload.jti?.length).toBeGreaterThan(0);
  });

  test("preserves explicit token id as jwt jti", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read"],
      expiresIn: "5m",
      tokenId: "token-123"
    });

    const payload = await verifyAccessToken(token, {
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp"
    });

    expect(payload.jti).toBe("token-123");
  });

  test("rejects a token when its jti is revoked", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read"],
      expiresIn: "5m",
      tokenId: "revoked-token"
    });

    await expect(
      verifyAccessToken(token, {
        secret,
        issuer: "https://clockify-mcp.local",
        audience: "clockify-mcp",
        revocationStore: {
          isRevoked: (tokenId) => tokenId === "revoked-token",
          revoke: () => undefined
        }
      })
    ).rejects.toThrow(TokenVerificationError);
  });

  test("rejects wrong audience", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read"],
      expiresIn: "5m"
    });

    await expect(
      verifyAccessToken(token, {
        secret,
        issuer: "https://clockify-mcp.local",
        audience: "other-resource"
      })
    ).rejects.toThrow(TokenVerificationError);
  });

  test("rejects expired token", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read"],
      expiresIn: "-1s"
    });

    await expect(
      verifyAccessToken(token, {
        secret,
        issuer: "https://clockify-mcp.local",
        audience: "clockify-mcp"
      })
    ).rejects.toThrow(TokenVerificationError);
  });

  test("requireScopes rejects missing scope", async () => {
    const token = await issueAccessToken({
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify:read"],
      expiresIn: "5m"
    });
    const payload = await verifyAccessToken(token, {
      secret,
      issuer: "https://clockify-mcp.local",
      audience: "clockify-mcp"
    });

    expect(() => requireScopes(payload, ["clockify:write"])).toThrow(/missing/i);
  });
});
