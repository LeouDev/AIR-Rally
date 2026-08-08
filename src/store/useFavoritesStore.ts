import { create } from "zustand";
import { persist } from "zustand/middleware";

type FavoritesState = {
  courtIds: string[];
  isFavorite: (courtId: string) => boolean;
  toggleFavorite: (courtId: string) => void;
};

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      courtIds: [],
      isFavorite: (courtId) => get().courtIds.includes(courtId),
      toggleFavorite: (courtId) =>
        set((state) => ({
          courtIds: state.courtIds.includes(courtId)
            ? state.courtIds.filter((id) => id !== courtId)
            : [...state.courtIds, courtId],
        })),
    }),
    { name: "air-rally-favorites" }
  )
);
