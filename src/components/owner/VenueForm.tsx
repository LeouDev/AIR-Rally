"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createVenueDraftAction } from "@/lib/actions/venue";
import { updateVenueAction } from "@/lib/actions/venue";
import { createVenueDraftSchema, type CreateVenueDraftValues } from "@/lib/validations/venue";

const DEFAULT_VALUES: CreateVenueDraftValues = {
  name: "",
  description: "",
  address: "",
  city: "",
  stateProvince: "",
  country: "Philippines",
  phone: "",
  email: "",
  website: "",
  indoorOutdoor: "outdoor",
  numberOfCourts: 1,
};

type VenueFormProps =
  | { mode: "create" }
  | { mode: "edit"; venueId: string; initialValues: CreateVenueDraftValues };

export function VenueForm(props: VenueFormProps) {
  const router = useRouter();
  const isEdit = props.mode === "edit";

  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateVenueDraftValues>({
    resolver: zodResolver(createVenueDraftSchema),
    defaultValues: isEdit ? props.initialValues : DEFAULT_VALUES,
  });

  async function onSubmit(values: CreateVenueDraftValues) {
    const result = isEdit
      ? await updateVenueAction(props.venueId, values)
      : await createVenueDraftAction(values);

    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }

    if (isEdit) {
      toast.success("Venue updated");
      reset(values);
      router.refresh();
    } else {
      toast.success(`${result.data.name} saved as a draft`);
      reset(DEFAULT_VALUES);
      router.refresh();
    }
  }

  return (
    <form
      id="venue-form"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      {!isEdit && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tell us about your venue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This saves as a draft — nothing goes live until you submit it for review.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Venue name</Label>
        <Input id="name" placeholder="Banilad Pickle Club" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          rows={4}
          placeholder="Tell players what makes your venue worth playing at."
          aria-invalid={!!errors.description}
          className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          {...register("description")}
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Street address</Label>
        <Input id="address" aria-invalid={!!errors.address} {...register("address")} />
        {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" aria-invalid={!!errors.city} {...register("city")} />
          {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stateProvince">State / Province</Label>
          <Input id="stateProvince" {...register("stateProvince")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" aria-invalid={!!errors.country} {...register("country")} />
          {errors.country && <p className="text-xs text-destructive">{errors.country.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Contact phone</Label>
          <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...register("phone")} />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Contact email</Label>
          <Input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="website">Website (optional)</Label>
        <Input id="website" type="url" placeholder="https://…" aria-invalid={!!errors.website} {...register("website")} />
        {errors.website && <p className="text-xs text-destructive">{errors.website.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="indoorOutdoor">Indoor / Outdoor</Label>
          <Select
            value={watch("indoorOutdoor")}
            onValueChange={(value) => setValue("indoorOutdoor", value as CreateVenueDraftValues["indoorOutdoor"], { shouldDirty: true })}
          >
            <SelectTrigger id="indoorOutdoor" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="indoor">Indoor</SelectItem>
              <SelectItem value="outdoor">Outdoor</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="numberOfCourts">Number of courts</Label>
          <Input
            id="numberOfCourts"
            type="number"
            min={1}
            max={100}
            aria-invalid={!!errors.numberOfCourts}
            {...register("numberOfCourts", { valueAsNumber: true })}
          />
          {errors.numberOfCourts && (
            <p className="text-xs text-destructive">{errors.numberOfCourts.message}</p>
          )}
        </div>
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <Button
        type="submit"
        size="lg"
        className="mt-2 self-start"
        disabled={isSubmitting || (isEdit && !isDirty)}
      >
        {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Save as Draft"}
      </Button>
    </form>
  );
}
