import {
  apiContract,
  errorSchema,
  type JoinByCodeInput,
  type JoinInput,
  type PrivateLobbyCreateInput,
} from "@impromptu/api/contracts";

async function readResponse<T>(
  response: Response,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = errorSchema.safeParse(payload);
    throw new Error(error.success ? error.data.message : "The request failed");
  }

  return schema.parse(payload);
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
  const response = await fetch(path, {
    method: apiContract.privateTopic.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const payload: unknown = await response.json().catch(() => null);
    return apiContract.privateTopic.errors[409].parse(payload);
  }
  return readResponse(response, apiContract.privateTopic.response);
}

export async function lookupPrivateLobby(code: string) {
  const response = await fetch(apiContract.privateLobbyLookup.path, {
    method: apiContract.privateLobbyLookup.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  return readResponse(response, apiContract.privateLobbyLookup.response);
}

export async function joinTopicByCode(input: JoinByCodeInput) {
  const response = await fetch(apiContract.joinByCode.path, {
    method: apiContract.joinByCode.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
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
  const response = await fetch(path, {
    method: apiContract.join.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const payload: unknown = await response.json().catch(() => null);
    return apiContract.join.errors[409].parse(payload);
  }
  return readResponse(response, apiContract.join.response);
}

export async function leaveTopic(
  topicId: string,
  lobbyId: string,
  participantIdentity: string,
) {
  const path = apiContract.leave.path.replace(
    ":topicId",
    encodeURIComponent(topicId),
  );
  const response = await fetch(path, {
    method: apiContract.leave.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ lobbyId, participantIdentity }),
  });
  return readResponse(response, apiContract.leave.response);
}
