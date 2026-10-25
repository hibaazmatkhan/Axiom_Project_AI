import { Suspense } from "react";
import GameLoader from "./GameLoader";

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <GameLoader />
    </Suspense>
  );
}
