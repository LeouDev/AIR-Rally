"use server";

import { revalidatePath } from "next/cache";
import { createPost, deletePost, likePost, unlikePost, createComment, deleteComment } from "@/lib/services/posts";
import { createPostSchema, createCommentSchema, type CreatePostValues, type CreateCommentValues } from "@/lib/validations/post";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import type { Post, PostComment } from "@/lib/supabase/types";

export async function createPostAction(values: CreatePostValues): Promise<ActionResult<Post>> {
  const parsed = createPostSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to post on COURT/Side." };
  }

  try {
    const post = await createPost(supabase, user.id, parsed.data.content, parsed.data.imageUrl);
    revalidatePath("/court-side");
    return { success: true, data: post };
  } catch (error) {
    logServerError("posts.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't publish your post.") };
  }
}

export async function deletePostAction(postId: string): Promise<ActionResult> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to manage your posts." };
  }

  try {
    await deletePost(supabase, postId);
    revalidatePath("/court-side");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("posts.delete", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't remove that post.") };
  }
}

export async function toggleLikeAction(postId: string, currentlyLiked: boolean): Promise<ActionResult<{ liked: boolean }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to like posts." };
  }

  try {
    if (currentlyLiked) {
      await unlikePost(supabase, user.id, postId);
    } else {
      await likePost(supabase, user.id, postId);
    }
    return { success: true, data: { liked: !currentlyLiked } };
  } catch (error) {
    logServerError("posts.toggleLike", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that.") };
  }
}

export async function createCommentAction(values: CreateCommentValues): Promise<ActionResult<PostComment>> {
  const parsed = createCommentSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to comment." };
  }

  try {
    const comment = await createComment(supabase, user.id, parsed.data.postId, parsed.data.content);
    return { success: true, data: comment };
  } catch (error) {
    logServerError("posts.createComment", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't post your reply.") };
  }
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to manage your comments." };
  }

  try {
    await deleteComment(supabase, commentId);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("posts.deleteComment", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't remove that comment.") };
  }
}
