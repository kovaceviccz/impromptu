import {
  apiContract,
  errorSchema,
  formErrorSchema,
  type JoinByCodeInput,
  type JoinInput,
  type LoginInput,
  type PrivateLobbyCreateInput,
  type RegisterInput,
  type UpdateAccountInput,
} from "@impromptu/api/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readResponse<T>(
  response: Response,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const formError = formErrorSchema.safeParse(payload);
    if (formError.success) {
      throw new ApiError(
        formError.data.message,
        response.status,
        formError.data.fieldErrors,
      );
    }
    const error = errorSchema.safeParse(payload);
    throw new ApiError(
      error.success ? error.data.message : "The request failed",
      response.status,
    );
  }

  return schema.parse(payload);
}

function postJson(path: string, body?: unknown) {
  return fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function getTopics() {
  const response = await fetch(apiContract.topics.path, {
    headers: { accept: "application/json" },
  });
  return readResponse(response, apiContract.topics.response);
}

export async function createPrivateTopic(
  topicId: string,
  input: PrivateLobbyCreateInput,
) {
  const path = apiContract.privateTopic.path.replace(
    ":topicId",
    encodeURIComponent(topicId),
  );
  const response = await postJson(path, input);
  if (response.status === 409) {
    const payload: unknown = await response.json().catch(() => null);
    return apiContract.privateTopic.errors[409].parse(payload);
  }
  return readResponse(response, apiContract.privateTopic.response);
}

export async function lookupPrivateLobby(code: string) {
  const response = await postJson(apiContract.privateLobbyLookup.path, {
    code,
  });
  return readResponse(response, apiContract.privateLobbyLookup.response);
}

export async function joinTopicByCode(input: JoinByCodeInput) {
  const response = await postJson(apiContract.joinByCode.path, input);
  if (response.status === 409) {
    const payload: unknown = await response.json().catch(() => null);
    return apiContract.joinByCode.errors[409].parse(payload);
  }
  return readResponse(response, apiContract.joinByCode.response);
}

export async function joinTopic(topicId: string, input: JoinInput) {
  const path = apiContract.join.path.replace(
    ":topicId",
    encodeURIComponent(topicId),
  );
  const response = await postJson(path, input);
  if (response.status === 409) {
    const payload: unknown = await response.json().catch(() => null);
    return apiContract.join.errors[409].parse(payload);
  }
  return readResponse(response, apiContract.join.response);
}

export async function leaveTopic(
  topicId: string,
  lobbyId: string,
  token: string,
) {
  const path = apiContract.leave.path.replace(
    ":topicId",
    encodeURIComponent(topicId),
  );
  const response = await postJson(path, { lobbyId, token });
  return readResponse(response, apiContract.leave.response);
}

export async function register(input: RegisterInput) {
  const response = await postJson(apiContract.register.path, input);
  return readResponse(response, apiContract.register.response);
}

export async function login(input: LoginInput) {
  const response = await postJson(apiContract.login.path, input);
  return readResponse(response, apiContract.login.response);
}

export async function logout() {
  const response = await postJson(apiContract.logout.path);
  return readResponse(response, apiContract.logout.response);
}

export async function getSession() {
  const response = await fetch(apiContract.session.path, {
    headers: { accept: "application/json" },
  });
  return readResponse(response, apiContract.session.response);
}

export async function getAccount() {
  const response = await fetch(apiContract.account.path, {
    headers: { accept: "application/json" },
  });
  return readResponse(response, apiContract.account.response);
}

export async function updateAccount(input: UpdateAccountInput) {
  const response = await fetch(apiContract.updateAccount.path, {
    method: apiContract.updateAccount.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return readResponse(response, apiContract.updateAccount.response);
}

export async function deleteAccount() {
  const response = await fetch(apiContract.deleteAccount.path, {
    method: apiContract.deleteAccount.method,
    headers: { accept: "application/json" },
  });
  return readResponse(response, apiContract.deleteAccount.response);
}

export async function getRoomParticipants(join: {
  topicId: string;
  lobbyId: string;
  token: string;
}) {
  const path = apiContract.roomParticipants.path.replace(
    ":topicId",
    encodeURIComponent(join.topicId),
  );
  const response = await postJson(path, {
    lobbyId: join.lobbyId,
    token: join.token,
  });
  return readResponse(response, apiContract.roomParticipants.response);
}
