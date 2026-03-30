/**
 * PR-040: Pinterest API direct publishing — Remix route
 *
 * Handles:
 *  - GET  /app/pinterest           — Dashboard: connection status + board list + pin history
 *  - GET  /app/pinterest/connect   — Redirects to Pinterest OAuth
 *  - GET  /app/pinterest/callback  — OAuth callback; exchanges code, saves connection
 *  - POST /app/pinterest/pin       — Immediately create or schedule a pin
 *  - POST /app/pinterest/disconnect — Removes stored connection
 */

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSearchParams,
  Form,
  Link,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  DataTable,
  Select,
  TextField,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import {
  getPinterestOAuthUrl,
  validateOAuthState,
  exchangeCodeForTokens,
  fetchPinterestUserId,
  fetchPinterestBoards,
  savePinterestConnection,
  getPinterestConnection,
  deletePinterestConnection,
  createScheduledPin,
  getShopPins,
  createPin,
  markPinPublished,
  markPinFailed,
} from "../../src/pinterest.server.js";
import type {
  PinterestEnv,
  PinterestBoard,
  ScheduledPin,
} from "../../src/pinterest.server.js";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Env type combining Shopify + Pinterest bindings
// ---------------------------------------------------------------------------

type Env = ShopifyEnv & PinterestEnv;

// ---------------------------------------------------------------------------
// Loader — dashboard data
// ---------------------------------------------------------------------------

interface LoaderData {
  shop: string;
  connected: boolean;
  pinterestUserId: string | null;
  connectedAt: string | null;
  boards: PinterestBoard[];
  pins: ScheduledPin[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/callback")) {
    return handleCallback(request);
  }

  if (url.pathname.endsWith("/connect")) {
    return handleConnect(request);
  }

  return handleDashboardLoader(request);
}

async function getEnv(request: Request): Promise<Env> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (request as any)._env as Env;
}

async function handleDashboardLoader(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (request as any)._context;
  const env: Env = context?.cloudflare?.env ?? (await getEnv(request));

  const auth = await shopifyAuth(request, env).catch(() => null);
  if (!auth) {
    return json<LoaderData>({
      shop: "",
      connected: false,
      pinterestUserId: null,
      connectedAt: null,
      boards: [],
      pins: [],
    });
  }

  const conn = await getPinterestConnection(auth.shop, env).catch(() => null);
  let boards: PinterestBoard[] = [];
  let pins: ScheduledPin[] = [];

  if (conn) {
    boards = await fetchPinterestBoards(conn.access_token).catch(() => []);
    pins = await getShopPins(auth.shop, env).catch(() => []);
  }

  return json<LoaderData>({
    shop: auth.shop,
    connected: !!conn,
    pinterestUserId: conn?.pinterest_user_id ?? null,
    connectedAt: conn?.connected_at ?? null,
    boards,
    pins,
  });
}

async function handleConnect(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (request as any)._context;
  const env: Env = context?.cloudflare?.env ?? (await getEnv(request));

  const auth = await shopifyAuth(request, env).catch(() => null);
  if (!auth) {
    return redirect("/auth");
  }

  const oauthUrl = await getPinterestOAuthUrl(auth.shop, env);
  return redirect(oauthUrl);
}

async function handleCallback(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (request as any)._context;
  const env: Env = context?.cloudflare?.env ?? (await getEnv(request));

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return redirect("/app/pinterest?error=access_denied");
  }

  if (!code || !rawState) {
    return redirect("/app/pinterest?error=missing_params");
  }

  let shop: string;
  let codeVerifier: string;
  try {
    const validated = await validateOAuthState(rawState, env);
    shop = validated.shop;
    codeVerifier = validated.codeVerifier;
  } catch {
    return redirect("/app/pinterest?error=invalid_state");
  }

  try {
    const { accessToken, refreshToken, expiresAt } = await exchangeCodeForTokens(
      code,
      codeVerifier,
      env
    );
    const pinterestUserId = await fetchPinterestUserId(accessToken);
    await savePinterestConnection(
      shop,
      pinterestUserId,
      accessToken,
      refreshToken,
      expiresAt,
      env
    );
  } catch {
    return redirect("/app/pinterest?error=token_exchange_failed");
  }

  return redirect("/app/pinterest?connected=1");
}

// ---------------------------------------------------------------------------
// Action — pin / disconnect
// ---------------------------------------------------------------------------

interface ActionData {
  success?: boolean;
  error?: string;
  pinId?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (request as any)._context;
  const env: Env = context?.cloudflare?.env ?? (await getEnv(request));

  const auth = await shopifyAuth(request, env).catch(() => null);
  if (!auth) {
    return json<ActionData>({ error: "Unauthorised" }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "disconnect") {
    await deletePinterestConnection(auth.shop, env);
    return json<ActionData>({ success: true });
  }

  if (intent === "pin") {
    const imageUrl = formData.get("image_url") as string;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const boardId = formData.get("board_id") as string;
    const boardName = (formData.get("board_name") as string) || boardId;
    const link = (formData.get("link") as string) || undefined;
    const altText = (formData.get("alt_text") as string) || undefined;
    const scheduledAt = (formData.get("scheduled_at") as string) || undefined;

    if (!imageUrl || !title || !boardId) {
      return json<ActionData>(
        { error: "image_url, title, and board_id are required" },
        { status: 400 }
      );
    }

    const conn = await getPinterestConnection(auth.shop, env);
    if (!conn) {
      return json<ActionData>(
        { error: "No Pinterest account connected. Please connect first." },
        { status: 400 }
      );
    }

    // Schedule if scheduledAt is provided and in the future
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      const pinScheduledId = await createScheduledPin(
        {
          shop: auth.shop,
          pinterestUserId: conn.pinterest_user_id,
          boardId,
          boardName,
          r2ImageKey: imageUrl,
          imageUrl,
          title,
          description,
          link,
          altText,
          scheduledAt,
        },
        env
      );
      return json<ActionData>({ success: true, pinId: pinScheduledId });
    }

    // Create pin record then publish immediately
    const rowId = await createScheduledPin(
      {
        shop: auth.shop,
        pinterestUserId: conn.pinterest_user_id,
        boardId,
        boardName,
        r2ImageKey: imageUrl,
        imageUrl,
        title,
        description,
        link,
        altText,
      },
      env
    );

    try {
      const result = await createPin({
        accessToken: conn.access_token,
        boardId,
        imageUrl,
        title,
        description,
        link,
        altText,
      });
      await markPinPublished(rowId, auth.shop, result.pinId, env);
      return json<ActionData>({ success: true, pinId: result.pinId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPinFailed(rowId, auth.shop, msg, env);
      return json<ActionData>({ error: msg }, { status: 500 });
    }
  }

  return json<ActionData>({ error: "Unknown intent" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// UI Component
// ---------------------------------------------------------------------------

function pinStatusBadge(status: ScheduledPin["status"]) {
  if (status === "published") return <Badge tone="success">Published</Badge>;
  if (status === "failed") return <Badge tone="critical">Failed</Badge>;
  return <Badge tone="attention">Pending</Badge>;
}

export default function PinterestPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedBoard, setSelectedBoard] = useState(
    data.boards[0]?.id ?? ""
  );
  const [link, setLink] = useState("");
  const [altText, setAltText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [searchParams] = useSearchParams();

  const connectError = searchParams.get("error");
  const justConnected = searchParams.get("connected") === "1";

  const boardOptions = data.boards.map((b) => ({
    label: b.name,
    value: b.id,
  }));

  const pinRows = data.pins.map((p) => [
    p.title,
    p.board_name,
    p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "Immediate",
    pinStatusBadge(p.status),
    p.error_message ?? "—",
  ]);

  return (
    <Page
      title="Pinterest Publishing"
      subtitle="Connect your Pinterest business account to create pins directly from generated images."
    >
      {/* Connection error banner */}
      {connectError && (
        <Banner tone="critical" title="Pinterest connection failed">
          <Text as="p" variant="bodyMd">
            {connectError === "access_denied"
              ? "You denied access. Please try connecting again."
              : connectError === "invalid_state"
              ? "Security check failed. Please try again."
              : "An error occurred during connection. Please try again."}
          </Text>
        </Banner>
      )}

      {/* Just connected banner */}
      {justConnected && (
        <Banner tone="success" title="Pinterest connected!">
          <Text as="p" variant="bodyMd">
            Your Pinterest business account is now linked. Select a board and
            create your first pin below.
          </Text>
        </Banner>
      )}

      {/* Action result banner */}
      {actionData?.error && (
        <Banner tone="critical" title="Action failed">
          <Text as="p" variant="bodyMd">{actionData.error}</Text>
        </Banner>
      )}
      {actionData?.success && !actionData?.pinId && (
        <Banner tone="success" title="Pin scheduled successfully" />
      )}

      <Layout>
        {/* Connection card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Account Connection
              </Text>

              {data.connected ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Badge tone="success">Connected</Badge>
                    <Text as="span" variant="bodyMd">
                      @{data.pinterestUserId}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Connected on{" "}
                    {data.connectedAt
                      ? new Date(data.connectedAt).toLocaleDateString()
                      : "—"}
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <Button
                      variant="plain"
                      tone="critical"
                      submit
                      loading={isSubmitting}
                      accessibilityLabel="Disconnect Pinterest account"
                    >
                      Disconnect
                    </Button>
                  </Form>
                </BlockStack>
              ) : (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Connect your Pinterest business account to create pins with
                    board selection and product metadata.
                  </Text>
                  <Link to="/app/pinterest/connect">
                    <Button
                      variant="primary"
                      accessibilityLabel="Connect Pinterest account"
                    >
                      Connect Pinterest
                    </Button>
                  </Link>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pin creation card — only shown when connected */}
        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Create Pin
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="pin" />
                  <input
                    type="hidden"
                    name="board_name"
                    value={
                      data.boards.find((b) => b.id === selectedBoard)?.name ??
                      selectedBoard
                    }
                  />
                  <BlockStack gap="300">
                    <TextField
                      label="Image URL"
                      name="image_url"
                      value={imageUrl}
                      onChange={setImageUrl}
                      placeholder="https://..."
                      helpText="Publicly accessible image URL (JPEG/PNG, minimum 100×100px)."
                      autoComplete="off"
                    />
                    <TextField
                      label="Title"
                      name="title"
                      value={title}
                      onChange={setTitle}
                      maxLength={100}
                      showCharacterCount
                      autoComplete="off"
                    />
                    <TextField
                      label="Description"
                      name="description"
                      value={description}
                      onChange={setDescription}
                      multiline={3}
                      maxLength={500}
                      showCharacterCount
                      autoComplete="off"
                    />
                    <Select
                      label="Board"
                      name="board_id"
                      options={boardOptions}
                      value={selectedBoard}
                      onChange={setSelectedBoard}
                      helpText="Select the board where this pin will be created."
                    />
                    <TextField
                      label="Product link (optional)"
                      name="link"
                      value={link}
                      onChange={setLink}
                      placeholder="https://your-store.myshopify.com/products/..."
                      helpText="The destination URL when users click the pin."
                      autoComplete="off"
                    />
                    <TextField
                      label="Alt text (optional)"
                      name="alt_text"
                      value={altText}
                      onChange={setAltText}
                      maxLength={500}
                      helpText="Descriptive text for screen readers and accessibility."
                      autoComplete="off"
                    />
                    <TextField
                      label="Schedule (optional)"
                      name="scheduled_at"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={setScheduledAt}
                      helpText="Leave blank to publish immediately."
                      autoComplete="off"
                    />
                    <Button
                      variant="primary"
                      submit
                      loading={isSubmitting}
                      disabled={!imageUrl || !title || !selectedBoard}
                      accessibilityLabel={
                        scheduledAt ? "Schedule Pinterest pin" : "Create pin now"
                      }
                    >
                      {scheduledAt ? "Schedule Pin" : "Create Pin Now"}
                    </Button>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Pin history */}
        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Pin History
                </Text>
                {data.pins.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No pins yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Title", "Board", "Scheduled", "Status", "Error"]}
                    rows={pinRows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
