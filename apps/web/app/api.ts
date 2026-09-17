import {
  apiContract,
  errorSchema,
  type JoinInput,
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

export async function leaveTopic(topicId: string, participantIdentity: string) {
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
    body: JSON.stringify({ participantIdentity }),
  });
  return readResponse(response, apiContract.leave.response);
}
