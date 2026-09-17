import { PRODUCT, type TopicStatus } from "@impromptu/api/contracts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Form,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import { getTopics } from "../api";

export const MEDIA_PERMISSION_MESSAGE =
  "Video and audio permissions must be given. Try again.";

export function meta() {
  return [
    { title: PRODUCT.name },
    {
      name: "description",
      content: "Choose a topic, take a side, and debate it live.",
    },
  ];
}

export async function clientLoader() {
  return getTopics();
}

type Selection = {
  topic: TopicStatus;
  sideIndex: 0 | 1;
};

const sideIndexes = [0, 1] as const;

export function TopicList({ topics }: { topics: TopicStatus[] }) {
  const [selection, setSelection] = useState<Selection>();
  const [topicIndex, setTopicIndex] = useState(0);
  const touchStart = useRef<number | undefined>(undefined);
  const navigation = useNavigation();
  const isJoining = navigation.state === "submitting";
  const topic = topics[topicIndex] ?? topics[0];

  if (!topic) {
    return (
      <p className="m-auto text-center text-muted-foreground">
        No debates are available right now.
      </p>
    );
  }

  function moveTopic(offset: number) {
    setTopicIndex(
      (current) => (current + offset + topics.length) % topics.length,
    );
  }

  return (
    <>
      <section
        aria-label="Debate topics"
        className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3"
      >
        <header className="flex items-end justify-between gap-4">
          <h1 className="text-base font-medium tracking-tight text-muted-foreground sm:text-lg">
            Choose a topic and side to debate
          </h1>
          <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {topicIndex + 1} of {topics.length}
          </p>
        </header>

        <div className="relative min-h-0">
          <Card
            className="h-full min-h-0 gap-0 overflow-hidden bg-card py-0 ring-0"
            onTouchEnd={(event) => {
              if (touchStart.current === undefined) return;
              const distance =
                event.changedTouches[0]!.clientX - touchStart.current;
              if (Math.abs(distance) >= 60) moveTopic(distance < 0 ? 1 : -1);
              touchStart.current = undefined;
            }}
            onTouchStart={(event) => {
              touchStart.current = event.touches[0]!.clientX;
            }}
          >
            <header className="grid h-24 content-center gap-3 px-5 py-4 sm:h-28 sm:px-7">
              <h2 className="font-editorial max-w-full text-[clamp(1.5rem,5.5vw,2.75rem)] leading-none font-semibold tracking-tight whitespace-nowrap">
                {topic.title}
              </h2>
              <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {topic.debaterCount === 0
                    ? "Both sides open"
                    : topic.debaterCount === 1
                      ? "One side open"
                      : "Both sides taken"}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {topic.spectatorCount === 0
                    ? "No one watching"
                    : `${topic.spectatorCount} ${
                        topic.spectatorCount === 1 ? "person" : "people"
                      } watching`}
                </span>
              </p>
            </header>

            <CardContent className="grid min-h-0 flex-1 grid-cols-2 bg-transparent p-0">
              {sideIndexes.map((sideIndex) => {
                const side = topic.sides[sideIndex];
                const available = topic.sideAvailability[sideIndex];

                return (
                  <section
                    className={
                      "flex min-w-0 flex-col gap-4 px-4 pt-4 pb-4 sm:px-7 sm:pt-7 " +
                      (sideIndex === 0 ? "bg-emerald-50" : "bg-red-50")
                    }
                    key={side}
                  >
                    <h3
                      className={
                        "font-editorial text-xl leading-snug font-semibold sm:text-2xl " +
                        (sideIndex === 0 ? "text-emerald-800" : "text-red-800")
                      }
                    >
                      {side}
                    </h3>
                    <Button
                      className={
                        "mt-auto h-11 w-full text-base " +
                        (sideIndex === 0
                          ? "bg-emerald-800 text-white hover:bg-emerald-900"
                          : "bg-red-800 text-white hover:bg-red-900")
                      }
                      disabled={!available}
                      size="lg"
                      type="button"
                      onClick={() => setSelection({ topic, sideIndex })}
                    >
                      {available ? "Debate" : "Side taken"}
                      <span className="sr-only">: {side}</span>
                    </Button>
                  </section>
                );
              })}
            </CardContent>

            <footer>
              <Form
                action={"/debates/" + topic.id}
                className="w-full"
                method="post"
              >
                <input name="intent" type="hidden" value="spectator" />
                <Button
                  className="h-14 w-full rounded-none bg-card text-base hover:bg-[#f5f8fb] active:not-aria-[haspopup]:translate-y-0"
                  size="lg"
                  type="submit"
                  variant="secondary"
                >
                  Watch live
                </Button>
              </Form>
            </footer>
          </Card>

          <Button
            className="absolute top-[calc(50%-1.125rem)] left-1 z-10 bg-transparent text-foreground/50 shadow-none transition-none hover:bg-transparent hover:text-foreground active:not-aria-[haspopup]:translate-y-0 sm:left-2"
            disabled={topics.length < 2}
            size="icon-lg"
            type="button"
            variant="ghost"
            onClick={() => moveTopic(-1)}
          >
            <ChevronLeftIcon />
            <span className="sr-only">Previous topic</span>
          </Button>
          <Button
            className="absolute top-[calc(50%-1.125rem)] right-1 z-10 bg-transparent text-foreground/50 shadow-none transition-none hover:bg-transparent hover:text-foreground active:not-aria-[haspopup]:translate-y-0 sm:right-2"
            disabled={topics.length < 2}
            size="icon-lg"
            type="button"
            variant="ghost"
            onClick={() => moveTopic(1)}
          >
            <ChevronRightIcon />
            <span className="sr-only">Next topic</span>
          </Button>
        </div>
      </section>

      <Dialog
        open={selection !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelection(undefined);
        }}
      >
        <DialogContent>
          {selection ? (
            <Form
              action={"/debates/" + selection.topic.id}
              className="grid gap-4"
              method="post"
            >
              <DialogHeader>
                <DialogTitle className="font-editorial text-xl">
                  Debate this topic
                </DialogTitle>
                <DialogDescription>{selection.topic.title}</DialogDescription>
              </DialogHeader>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Your position
                </p>
                <p className="font-medium">
                  {selection.topic.sides[selection.sideIndex]}
                </p>
              </div>
              <div>
                <label className="sr-only" htmlFor="display-name">
                  Display name
                </label>
                <Input
                  autoComplete="nickname"
                  id="display-name"
                  maxLength={40}
                  name="displayName"
                  pattern=".*\S.*"
                  placeholder="Display name"
                  required
                  title="Enter a display name."
                />
              </div>
              <input name="intent" type="hidden" value="debater" />
              <input
                name="sideIndex"
                type="hidden"
                value={selection.sideIndex}
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelection(undefined)}
                >
                  Cancel
                </Button>
                <Button disabled={isJoining} type="submit">
                  Debate
                </Button>
              </div>
            </Form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Home() {
  const topics = useLoaderData<typeof clientLoader>();
  const location = useLocation();
  const navigate = useNavigate();
  const arrivedAfterMediaPermissionFailure =
    typeof location.state === "object" &&
    location.state !== null &&
    "mediaPermissionFailure" in location.state &&
    location.state.mediaPermissionFailure === true;
  const [showMediaPermissionFailure] = useState(
    arrivedAfterMediaPermissionFailure,
  );

  useEffect(() => {
    if (!showMediaPermissionFailure) return;

    void navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { preventScrollReset: true, replace: true, state: null },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    showMediaPermissionFailure,
  ]);

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="bg-[#f8fafc]">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4 sm:px-6">
          <p className="font-editorial text-xl font-semibold tracking-tight text-primary">
            {PRODUCT.name}
          </p>
        </div>
      </header>
      <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-5">
        {showMediaPermissionFailure ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {MEDIA_PERMISSION_MESSAGE}
          </p>
        ) : null}
        <TopicList topics={topics} />
      </section>
    </main>
  );
}
