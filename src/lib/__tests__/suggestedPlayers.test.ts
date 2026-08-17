import { suggestedPlayersFromFeed, postCountLabel } from "@/lib/suggestedPlayers";
import type { FeedPost } from "@/lib/services/posts";
import type { PublicProfile } from "@/lib/supabase/types";

const VIEWER = "viewer-1";

function profile(id: string, name: string): PublicProfile {
  return { id, display_name: name, avatar_url: null };
}

function post(id: string, author: PublicProfile | null): FeedPost {
  return { id, user_id: author?.id ?? "ghost", author, resharer: null } as FeedPost;
}

const MARIELLE = profile("p1", "Marielle Rubio");
const ANGELO = profile("p2", "Angelo Bautista");
const RHEA = profile("p3", "Rhea Salvador");

describe("suggestedPlayersFromFeed", () => {
  it("suggests the people posting in the feed", () => {
    const suggestions = suggestedPlayersFromFeed(
      [post("a", MARIELLE), post("b", ANGELO)],
      { viewerId: VIEWER }
    );
    expect(suggestions.map((s) => s.profile.display_name)).toEqual([
      "Marielle Rubio",
      "Angelo Bautista",
    ]);
  });

  it("never suggests the viewer follows themselves", () => {
    // Their own posts are in their own feed — this only shows up once the
    // viewer has posted, so an empty test account would look fine.
    const me = profile(VIEWER, "Me");
    const suggestions = suggestedPlayersFromFeed([post("a", me), post("b", MARIELLE)], {
      viewerId: VIEWER,
    });
    expect(suggestions.map((s) => s.profile.id)).toEqual(["p1"]);
  });

  it("drops posts whose author no longer resolves, without leaving a gap", () => {
    // author is null for a deleted account; a nameless card would still
    // consume one of only four slots.
    const suggestions = suggestedPlayersFromFeed(
      [post("a", null), post("b", MARIELLE), post("c", null), post("d", ANGELO)],
      { viewerId: VIEWER }
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.profile.display_name)).toBe(true);
  });

  it("shows one card per person, counting their extra posts instead", () => {
    const suggestions = suggestedPlayersFromFeed(
      [post("a", MARIELLE), post("b", MARIELLE), post("c", MARIELLE), post("d", ANGELO)],
      { viewerId: VIEWER }
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({ postCount: 3 });
    expect(suggestions[1]).toMatchObject({ postCount: 1 });
  });

  it("omits people the viewer already follows", () => {
    const suggestions = suggestedPlayersFromFeed(
      [post("a", MARIELLE), post("b", ANGELO), post("c", RHEA)],
      { viewerId: VIEWER, alreadyFollowing: ["p2"] }
    );
    expect(suggestions.map((s) => s.profile.id)).toEqual(["p1", "p3"]);
  });

  it("keeps feed order — recency — rather than ranking by volume", () => {
    const suggestions = suggestedPlayersFromFeed(
      [post("a", RHEA), post("b", MARIELLE), post("c", MARIELLE)],
      { viewerId: VIEWER }
    );
    expect(suggestions.map((s) => s.profile.id)).toEqual(["p3", "p1"]);
  });

  it("caps the list", () => {
    const many = [MARIELLE, ANGELO, RHEA, profile("p4", "D"), profile("p5", "E")].map((p) =>
      post(`post-${p.id}`, p)
    );
    expect(suggestedPlayersFromFeed(many, { viewerId: VIEWER })).toHaveLength(4);
    expect(suggestedPlayersFromFeed(many, { viewerId: VIEWER, limit: 2 })).toHaveLength(2);
  });

  it("returns nothing when the feed is genuinely empty", () => {
    expect(suggestedPlayersFromFeed([], { viewerId: VIEWER })).toEqual([]);
  });
});

describe("postCountLabel", () => {
  it("pluralises", () => {
    expect(postCountLabel(1)).toBe("1 post");
    expect(postCountLabel(3)).toBe("3 posts");
  });
});
