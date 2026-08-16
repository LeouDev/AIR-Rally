"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { listCommentsForPost, type PostCommentWithAuthor } from "@/lib/services/posts";
import { createCommentAction, deleteCommentAction } from "@/lib/actions/posts";

type PostCommentsProps = {
  postId: string;
  currentUserId: string;
  isAdmin: boolean;
  onCountChange: (delta: number) => void;
};

function initialsFrom(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function PostComments({ postId, currentUserId, isAdmin, onCountChange }: PostCommentsProps) {
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(null);
  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    listCommentsForPost(supabase, postId)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function handleSubmit() {
    if (!draft.trim() || isPosting) return;
    setIsPosting(true);
    const result = await createCommentAction({ postId, content: draft.trim() });
    setIsPosting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setComments((current) => [
      ...(current ?? []),
      { ...result.data, author: { id: currentUserId, display_name: null, avatar_url: null } },
    ]);
    onCountChange(1);
    setDraft("");
  }

  async function handleDelete(commentId: string) {
    const result = await deleteCommentAction(commentId);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setComments((current) => (current ?? []).filter((c) => c.id !== commentId));
    onCountChange(-1);
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      {comments === null ? (
        <p className="text-xs text-muted-foreground">Loading replies…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No replies yet — be the first.</p>
      ) : (
        comments.map((comment) => {
          const authorName = comment.author?.display_name || "Player";
          const canDelete = comment.user_id === currentUserId || isAdmin;
          return (
            <div key={comment.id} className="flex items-start gap-2.5">
              <Avatar size="sm">
                <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                  {initialsFrom(authorName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-xs">
                <span className="font-semibold text-foreground">{authorName}</span>{" "}
                <span className="text-foreground">{comment.content}</span>
              </div>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(comment.id)}
                  aria-label="Delete reply"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          maxLength={280}
          placeholder="Write a reply…"
          className="h-8 flex-1 rounded-full border border-input bg-transparent px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="button" size="sm" className="h-8 px-3 text-xs" disabled={!draft.trim() || isPosting} onClick={handleSubmit}>
          Reply
        </Button>
      </div>
    </div>
  );
}
