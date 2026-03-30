/**
 * PR-039: Instagram Graph API direct publishing — Remix route
 *
 * Handles:
 *  - GET  /app/instagram           — Dashboard: connection status + post history
 *  - GET  /app/instagram/connect   — Redirects to Facebook Login OAuth
 *  - GET  /app/instagram/callback  — OAuth callback; exchanges code, saves connection
 *  - POST /app/instagram/post      — Immediately post or schedule a post
 *  - POST /app/instagram/disconnect — Removes stored connection
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
  Divider,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import {
  getInstagramOAuthUrl,
  validateOAuthState,
  exchangeCodeForLongLivedToken,
  fetchInstagramBusinessAccount,
  saveInstagramConnection,
  getInstagramConnection,
  deleteInstagramConnection,
  createScheduledPost,
  getShopPosts,
  publishToInstagram,
  markPostPublished,
  markPostFailed,
} from "../../src/instagram.server.js";
import type {
  InstagramEnv,
  ScheduledPost,
} from "../../src/instagram.server.js";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Env type combining Shopify + Instagram bindings
// ---------------------------------------------------------------------------

type Env = ShopifyEnv & InstagramEnv;

// ---------------------------------------------------------------------------
// Loader — dashboard data
// ---------------------------------------------------------------------------

interface LoaderData {
  shop: string;
  connected: boolean;
  pageName: string | null;
  igUserId: string | null;
  connectedAt: string | null;
  posts: ScheduledPost[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Extract env from Cloudflare adapter context
  const url = new URL(request.url);

  // Handle OAuth callback sub-path
  if (url.pathname.endsWith("/callback")) {
    return handleCallback(request);
  }

  // Handle OAuth initiation sub-path
  if (url.pathname.endsWith("/connect")) {
    return handleConnect(request);
  }

  // Default: return dashboard data (session required)
  return handleDashboardLoader(request);
}

async function getEnv(request: Request): Promise<Env> {
  // In Cloudflare Remix adapter, env is on context.cloudflare.env.
  // During testing / SSR the context is not available via request alone;
  // callers pass env directly. This helper is a thin wrapper for production.
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
      pageName: null,
      igUserId: null,
      connectedAt: null,
      posts: [],
    });
  }

  const conn = await getInstagramConnection(auth.shop, env).catch(() => null);
  let posts: ScheduledPost[] = [];
  if (conn) {
    posts = await getShopPosts(auth.shop, env).catch(() => []);
  }

  return json<LoaderData>({
    shop: auth.shop,
    connected: !!conn,
    pageName: conn?.page_name ?? null,
    igUserId: conn?.ig_user_id ?? null,
    connectedAt: conn?.connected_at ?? null,
    posts,
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

  const oauthUrl = await getInstagramOAuthUrl(auth.shop, env);
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
    // User denied OAuth — redirect to Instagram dashboard with error flag
    return redirect("/app/instagram?error=access_denied");
  }

  if (!code || !rawState) {
    return redirect("/app/instagram?error=missing_params");
  }

  let shop: string;
  try {
    shop = await validateOAuthState(rawState, env);
  } catch {
    return redirect("/app/instagram?error=invalid_state");
  }

  try {
    const fbToken = await exchangeCodeForLongLivedToken(code, env);
    const { igUserId, pageName } = await fetchInstagramBusinessAccount(fbToken);
    await saveInstagramConnection(shop, igUserId, fbToken, pageName, env);
  } catch {
    return redirect("/app/instagram?error=token_exchange_failed");
  }

  return redirect("/app/instagram?connected=1");
}

// ---------------------------------------------------------------------------
// Action — post / disconnect
// ---------------------------------------------------------------------------

interface ActionData {
  success?: boolean;
  error?: string;
  postId?: string;
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
    await deleteInstagramConnection(auth.shop, env);
    return json<ActionData>({ success: true });
  }

  if (intent === "post") {
    const imageUrl = formData.get("image_url") as string;
    const caption = formData.get("caption") as string;
    const postType = (formData.get("post_type") as "feed" | "story") ?? "feed";
    const scheduledAt = (formData.get("scheduled_at") as string) || undefined;

    if (!imageUrl || !caption) {
      return json<ActionData>({ error: "image_url and caption are required" }, { status: 400 });
    }

    const conn = await getInstagramConnection(auth.shop, env);
    if (!conn) {
      return json<ActionData>(
        { error: "No Instagram account connected. Please connect first." },
        { status: 400 }
      );
    }

    // If scheduledAt is provided and in the future, schedule it
    const isScheduled =
      scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      const postId = await createScheduledPost(
        {
          shop: auth.shop,
          igUserId: conn.ig_user_id,
          r2ImageKey: imageUrl, // caller passes R2 key as image_url for R2 lookups
          imageUrl,
          caption,
          postType,
          scheduledAt,
        },
        env
      );
      return json<ActionData>({ success: true, postId });
    }

    // Publish immediately
    const rowId = await createScheduledPost(
      {
        shop: auth.shop,
        igUserId: conn.ig_user_id,
        r2ImageKey: imageUrl,
        imageUrl,
        caption,
        postType,
      },
      env
    );

    try {
      const result = await publishToInstagram({
        igUserId: conn.ig_user_id,
        fbAccessToken: conn.fb_access_token,
        imageUrl,
        caption,
        postType,
      });
      await markPostPublished(rowId, auth.shop, result.postId, env);
      return json<ActionData>({ success: true, postId: result.postId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPostFailed(rowId, auth.shop, msg, env);
      return json<ActionData>({ error: msg }, { status: 500 });
    }
  }

  return json<ActionData>({ error: "Unknown intent" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// UI Component
// ---------------------------------------------------------------------------

function statusBadge(status: ScheduledPost["status"]) {
  if (status === "published") return <Badge tone="success">Published</Badge>;
  if (status === "failed") return <Badge tone="critical">Failed</Badge>;
  return <Badge tone="attention">Pending</Badge>;
}

export default function InstagramPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [caption, setCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [postType, setPostType] = useState<"feed" | "story">("feed");
  const [scheduledAt, setScheduledAt] = useState("");
  const [searchParams] = useSearchParams();

  const connectError = searchParams.get("error");
  const justConnected = searchParams.get("connected") === "1";

  const postRows = data.posts.map((p) => [
    p.post_type === "story" ? "Story" : "Feed",
    p.caption.slice(0, 60) + (p.caption.length > 60 ? "…" : ""),
    p.scheduled_at
      ? new Date(p.scheduled_at).toLocaleString()
      : "Immediate",
    statusBadge(p.status),
    p.error_message ?? "—",
  ]);

  return (
    <Page
      title="Instagram Publishing"
      subtitle="Connect your Instagram Business account to post generated images directly to feed and stories."
    >
      {/* Connection error banner */}
      {connectError && (
        <Banner tone="critical" title="Instagram connection failed">
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
        <Banner tone="success" title="Instagram connected!">
          <Text as="p" variant="bodyMd">
            Your Instagram Business account is now linked. You can post images below.
          </Text>
        </Banner>
      )}

      {/* Action result banner */}
      {actionData?.error && (
        <Banner tone="critical" title="Action failed">
          <Text as="p" variant="bodyMd">{actionData.error}</Text>
        </Banner>
      )}
      {actionData?.success && !actionData?.postId && (
        <Banner tone="success" title="Post queued successfully" />
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
                      {data.pageName}
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
                      accessibilityLabel="Disconnect Instagram account"
                    >
                      Disconnect
                    </Button>
                  </Form>
                </BlockStack>
              ) : (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Connect your Instagram Business account to start publishing
                    generated product images directly to your feed and stories.
                  </Text>
                  <Link to="/app/instagram/connect">
                    <Button variant="primary" accessibilityLabel="Connect Instagram account">
                      Connect Instagram
                    </Button>
                  </Link>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Post creation card — only shown when connected */}
        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Create Post
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="post" />
                  <BlockStack gap="300">
                    <TextField
                      label="Image URL"
                      name="image_url"
                      value={imageUrl}
                      onChange={setImageUrl}
                      placeholder="https://..."
                      helpText="Public URL of the generated image. Must be reachable by Facebook's servers."
                      autoComplete="off"
                    />
                    <TextField
                      label="Caption"
                      name="caption"
                      value={caption}
                      onChange={setCaption}
                      multiline={4}
                      maxLength={2200}
                      showCharacterCount
                      autoComplete="off"
                      helpText="Up to 2,200 characters. Stories do not display captions."
                    />
                    <Select
                      label="Post type"
                      name="post_type"
                      options={[
                        { label: "Feed post", value: "feed" },
                        { label: "Story", value: "story" },
                      ]}
                      value={postType}
                      onChange={(v) => setPostType(v as "feed" | "story")}
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
                      disabled={!imageUrl || !caption}
                      accessibilityLabel={
                        scheduledAt ? "Schedule Instagram post" : "Publish to Instagram now"
                      }
                    >
                      {scheduledAt ? "Schedule Post" : "Post Now"}
                    </Button>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Post history */}
        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Post History
                </Text>
                {data.posts.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No posts yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Type", "Caption", "Scheduled", "Status", "Error"]}
                    rows={postRows}
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
