export type JsonRpcId = unknown;

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data }
  };
}

export function jsonRpcMethodNotFound(id: JsonRpcId, message = "MCP method is not implemented."): JsonRpcErrorResponse {
  return jsonRpcError(id, -32601, message);
}

export function jsonRpcInvalidRequest(id: JsonRpcId, message = "Invalid JSON-RPC request."): JsonRpcErrorResponse {
  return jsonRpcError(id, -32600, message);
}

export function jsonRpcInvalidParams(id: JsonRpcId, message = "Invalid params."): JsonRpcErrorResponse {
  return jsonRpcError(id, -32602, message);
}
