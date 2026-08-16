"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClubAction } from "@/lib/actions/clubs";
import { CLUB_SKILL_LEVELS, CLUB_TYPES, CLUB_VISIBILITIES, type CreateClubValues } from "@/lib/validations/club";

const SKILL_LABELS: Record<(typeof CLUB_SKILL_LEVELS)[number], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  mixed: "All levels",
};

const TYPE_LABELS: Record<(typeof CLUB_TYPES)[number], string> = {
  social: "Social",
  competitive: "Competitive",
  training: "Training",
  casual: "Casual",
};

const VISIBILITY_LABELS: Record<(typeof CLUB_VISIBILITIES)[number], string> = {
  public: "Public — anyone can join instantly",
  approval_required: "Approval required — you review each request",
  private: "Private — invite only",
};

export function CreateClubForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<CreateClubValues>({
    name: "",
    description: "",
    location: "",
    skillLevel: "mixed",
    clubType: "social",
    visibility: "public",
  });

  function set<K extends keyof CreateClubValues>(key: K, value: CreateClubValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const result = await createClubAction({
      ...values,
      description: values.description?.trim() || undefined,
      location: values.location?.trim() || undefined,
    });

    if (!result.success) {
      setSubmitting(false);
      toast.error(result.error);
      return;
    }

    toast.success("Your club is live.");
    router.push(`/clubs/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="club-name">Club name</Label>
        <Input
          id="club-name"
          value={values.name}
          maxLength={80}
          required
          placeholder="Cebu Weekend Picklers"
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-description">Description</Label>
        <textarea
          id="club-description"
          value={values.description ?? ""}
          maxLength={2000}
          rows={4}
          placeholder="Who you are, when you play, and who should join."
          onChange={(e) => set("description", e.target.value)}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-location">Location</Label>
        <Input
          id="club-location"
          value={values.location ?? ""}
          maxLength={200}
          placeholder="Cebu City"
          onChange={(e) => set("location", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="club-skill">Skill level</Label>
          <Select value={values.skillLevel} onValueChange={(v) => set("skillLevel", v as CreateClubValues["skillLevel"])}>
            <SelectTrigger id="club-skill" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_SKILL_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {SKILL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="club-type">Club type</Label>
          <Select value={values.clubType} onValueChange={(v) => set("clubType", v as CreateClubValues["clubType"])}>
            <SelectTrigger id="club-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-visibility">Who can join</Label>
        <Select value={values.visibility} onValueChange={(v) => set("visibility", v as CreateClubValues["visibility"])}>
          <SelectTrigger id="club-visibility" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLUB_VISIBILITIES.map((visibility) => (
              <SelectItem key={visibility} value={visibility}>
                {VISIBILITY_LABELS[visibility]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting || !values.name.trim()}>
          {submitting ? "Creating…" : "Create club"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Running a club doesn&apos;t list a venue or manage courts — it&apos;s just your community.
        </p>
      </div>
    </form>
  );
}
