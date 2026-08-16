"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { joinClubAction, leaveClubAction, approveClubMemberAction, removeClubMemberAction } from "@/lib/actions/clubs";
import type { ClubMemberRole, ClubVisibility } from "@/lib/supabase/types";
import type { ClubMemberWithProfile } from "@/lib/services/clubs";

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type ClubMembershipProps = {
  clubId: string;
  visibility: ClubVisibility;
  viewerRole: ClubMemberRole | null;
  viewerPending: boolean;
  members: ClubMemberWithProfile[];
};

export function ClubMembership({ clubId, visibility, viewerRole, viewerPending, members }: ClubMembershipProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "pending");

  async function run(label: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(label);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {!viewerRole && (
        <div className="rounded-2xl border border-border bg-card p-5">
          {viewerPending ? (
            <p className="text-sm text-muted-foreground">Your request to join is waiting for approval.</p>
          ) : visibility === "private" ? (
            <p className="text-sm text-muted-foreground">This club is invite only.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {visibility === "approval_required"
                  ? "Request to join — an organizer will review it."
                  : "This club is open to anyone."}
              </p>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(visibility === "approval_required" ? "Request sent." : "Welcome to the club.", async () => {
                    const result = await joinClubAction(clubId);
                    return result.success ? { success: true } : { success: false, error: result.error };
                  })
                }
              >
                {visibility === "approval_required" ? "Request to join" : "Join club"}
              </Button>
            </div>
          )}
        </div>
      )}

      {viewerRole && viewerRole !== "owner" && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run("You've left the club.", async () => {
                const result = await leaveClubAction(clubId);
                return result.success ? { success: true } : { success: false, error: result.error };
              })
            }
          >
            Leave club
          </Button>
        </div>
      )}

      {canManage && pendingMembers.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-foreground">Pending requests</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {pendingMembers.map((member) => (
              <li key={member.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    {member.profile?.avatar_url && <AvatarImage src={member.profile.avatar_url} alt="" />}
                    <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
                      {initialsFrom(member.profile?.display_name ?? "Player")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-foreground">{member.profile?.display_name ?? "Player"}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run("Member approved.", async () => {
                        const result = await approveClubMemberAction(clubId, member.user_id);
                        return result.success ? { success: true } : { success: false, error: result.error };
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("Request declined.", async () => {
                        const result = await removeClubMemberAction(clubId, member.user_id);
                        return result.success ? { success: true } : { success: false, error: result.error };
                      })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold text-foreground">
          Members <span className="text-sm font-normal text-muted-foreground">({activeMembers.length})</span>
        </h2>
        {activeMembers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {activeMembers.map((member) => (
              <li key={member.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    {member.profile?.avatar_url && <AvatarImage src={member.profile.avatar_url} alt="" />}
                    <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
                      {initialsFrom(member.profile?.display_name ?? "Player")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-foreground">{member.profile?.display_name ?? "Player"}</span>
                </div>
                {member.role !== "member" && (
                  <Badge variant="outline" className="capitalize">
                    {member.role}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
