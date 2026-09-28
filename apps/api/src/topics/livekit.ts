import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";

export type DebateRole = "debater" | "spectator";
export type DebateSide = 0 | 1;

const SIDE_ATTRIBUTE = "debate.side";

export type LiveKitGateway = {
  listParticipants(
    roomName: string,
  ): Promise<
    { identity: string; role: DebateRole; sideIndex: DebateSide | null }[]
  >;
  issueToken(input: {
    displayName: string;
    identity: string;
    role: DebateRole;
    roomName: string;
    sideIndex: DebateSide | null;
  }): Promise<string>;
};

type LiveKitGatewayConfig = {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
  tokenTtlSeconds: number;
};

function isMissingRoom(error: unknown) {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as { code?: unknown; status?: unknown };
  return (
    candidate.status === 404 ||
    candidate.code === 5 ||
    candidate.code === "not_found" ||
    candidate.code === "NOT_FOUND"
  );
}

export function createLiveKitGateway(
  config: LiveKitGatewayConfig,
): LiveKitGateway {
  const rooms = new RoomServiceClient(
    config.apiUrl,
    config.apiKey,
    config.apiSecret,
  );

  return {
    async listParticipants(roomName) {
      try {
        const participants = await rooms.listParticipants(roomName);
        return participants.map((participant) => ({
          identity: participant.identity,
          role:
            participant.permission?.canPublish === true
              ? "debater"
              : "spectator",
          sideIndex:
            participant.attributes[SIDE_ATTRIBUTE] === "0"
              ? 0
              : participant.attributes[SIDE_ATTRIBUTE] === "1"
                ? 1
                : null,
        }));
      } catch (error) {
        if (isMissingRoom(error)) return [];
        throw error;
      }
    },

    async issueToken({ displayName, identity, role, roomName, sideIndex }) {
      const isDebater = role === "debater";
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        attributes:
          sideIndex === null
            ? undefined
            : { [SIDE_ATTRIBUTE]: String(sideIndex) },
        identity,
        name: displayName,
        ttl: `${config.tokenTtlSeconds}s`,
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canSubscribe: true,
        canPublish: isDebater,
        canPublishData: !isDebater,
        canUpdateOwnMetadata: !isDebater,
        canPublishSources: isDebater
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
          : [],
      });

      return token.toJwt();
    },
  };
}

export function createRoleAllocator(
  livekit: LiveKitGateway,
  tokenTtlSeconds: number,
) {
  const pending = new Map<
    string,
    Map<string, { expiresAt: number; sideIndex: DebateSide }>
  >();
  const locks = new Map<string, Promise<void>>();

  async function inLobbyLock<T>(lobbyId: string, action: () => Promise<T>) {
    const previous = locks.get(lobbyId) ?? Promise.resolve();
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => turn);
    locks.set(lobbyId, queued);
    await previous;

    try {
      return await action();
    } finally {
      release();
      if (locks.get(lobbyId) === queued) locks.delete(lobbyId);
    }
  }

  async function occupancy(lobbyId: string) {
    const active = await livekit.listParticipants(`debate-${lobbyId}`);
    const activeDebaters = new Set(
      active
        .filter((participant) => participant.role === "debater")
        .map((participant) => participant.identity),
    );
    const reservations =
      pending.get(lobbyId) ??
      new Map<string, { expiresAt: number; sideIndex: DebateSide }>();

    for (const [identity, reservation] of reservations) {
      if (reservation.expiresAt <= Date.now() || activeDebaters.has(identity)) {
        reservations.delete(identity);
      }
    }

    if (reservations.size === 0) pending.delete(lobbyId);
    else pending.set(lobbyId, reservations);

    return {
      debaterIdentities: new Set([...activeDebaters, ...reservations.keys()]),
      occupiedSides: new Set([
        ...active.flatMap((participant) =>
          participant.role === "debater" && participant.sideIndex !== null
            ? [participant.sideIndex]
            : [],
        ),
        ...[...reservations.values()].map(
          (reservation) => reservation.sideIndex,
        ),
      ]),
      spectatorCount: active.filter(
        (participant) => participant.role === "spectator",
      ).length,
    };
  }

  return {
    status(lobbyId: string) {
      return inLobbyLock(lobbyId, async () => {
        const { debaterIdentities, occupiedSides, spectatorCount } =
          await occupancy(lobbyId);
        return {
          debaterCount: Math.min(debaterIdentities.size, 2),
          sideAvailability: [
            !occupiedSides.has(0),
            !occupiedSides.has(1),
          ] as const,
          spectatorCount,
        };
      });
    },

    async join(
      lobbyId: string,
      identity: string,
      role: DebateRole,
      displayName: string,
      requestedSide: DebateSide | null,
    ) {
      if (role === "spectator") {
        const token = await livekit.issueToken({
          displayName,
          identity,
          role,
          roomName: `debate-${lobbyId}`,
          sideIndex: null,
        });
        return { token, sideIndex: null };
      }

      return inLobbyLock(lobbyId, async () => {
        const { debaterIdentities, occupiedSides } = await occupancy(lobbyId);
        if (
          requestedSide === null ||
          debaterIdentities.size >= 2 ||
          occupiedSides.has(requestedSide)
        ) {
          return undefined;
        }
        const sideIndex = requestedSide;

        const reservations =
          pending.get(lobbyId) ??
          new Map<string, { expiresAt: number; sideIndex: DebateSide }>();
        reservations.set(identity, {
          expiresAt: Date.now() + tokenTtlSeconds * 1000,
          sideIndex,
        });
        pending.set(lobbyId, reservations);

        try {
          const token = await livekit.issueToken({
            displayName,
            identity,
            role,
            roomName: `debate-${lobbyId}`,
            sideIndex,
          });
          return { token, sideIndex };
        } catch (error) {
          pending.get(lobbyId)?.delete(identity);
          throw error;
        }
      });
    },

    leave(lobbyId: string, identity: string) {
      return inLobbyLock(lobbyId, async () => {
        const reservations = pending.get(lobbyId);
        reservations?.delete(identity);
        if (reservations?.size === 0) pending.delete(lobbyId);
      });
    },
  };
}
