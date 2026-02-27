type SkeletonVariant = "cards" | "table" | "feed" | "explorer" | "profile" | "landing";

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-tft-surface ${className}`} />;
}

function CardsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border border-tft-border rounded-xl bg-tft-surface/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-5 w-24" />
            <SkeletonBox className="h-4 w-12 bg-tft-surface/60" />
          </div>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 7 }).map((_, j) => (
              <SkeletonBox key={j} className="w-12 h-12 rounded-lg" />
            ))}
            <div className="w-px h-10 bg-tft-border mx-1" />
            {Array.from({ length: 3 }).map((_, j) => (
              <SkeletonBox key={j} className="w-12 h-12 rounded-lg bg-tft-surface/60" />
            ))}
          </div>
          <div className="flex gap-4">
            {Array.from({ length: 3 }).map((_, j) => (
              <SkeletonBox key={j} className="h-8 w-16 bg-tft-surface/40" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <SkeletonBox className="h-9 w-48 rounded-md" />
        <SkeletonBox className="h-9 w-24 rounded-md" />
      </div>
      <div className="rounded-xl border border-tft-border overflow-hidden">
        <div className="bg-tft-surface/80 px-4 py-2.5 flex gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBox key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-2.5 border-t border-tft-border/50">
            <SkeletonBox className="w-8 h-8 rounded-lg" />
            <SkeletonBox className="h-3 w-20" />
            <SkeletonBox className="h-3 w-12 bg-tft-surface/60 ml-auto" />
            <SkeletonBox className="h-3 w-12 bg-tft-surface/60" />
            <SkeletonBox className="h-3 w-12 bg-tft-surface/60" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-3 mb-4">
        <SkeletonBox className="h-9 w-36 rounded-md" />
        <SkeletonBox className="h-9 w-24 rounded-md" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="border border-tft-border rounded-xl bg-tft-surface/30 p-3 flex items-center gap-3">
          <SkeletonBox className="h-6 w-6" />
          <SkeletonBox className="h-4 w-24" />
          <div className="flex gap-1 flex-1">
            {Array.from({ length: 8 }).map((_, j) => (
              <SkeletonBox key={j} className="w-9 h-9 rounded-lg bg-tft-surface/60" />
            ))}
          </div>
          <SkeletonBox className="h-4 w-12 bg-tft-surface/40" />
        </div>
      ))}
    </div>
  );
}

function ExplorerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SkeletonBox className="h-9 w-56 rounded-md" />
        <SkeletonBox className="h-9 w-32 rounded-md" />
        <SkeletonBox className="h-8 w-20 rounded-full bg-tft-surface/60" />
        <SkeletonBox className="h-8 w-20 rounded-full bg-tft-surface/60" />
      </div>
      <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
        {Array.from({ length: 20 }).map((_, i) => (
          <SkeletonBox key={i} className="w-full aspect-square rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <SkeletonBox className="h-8 w-40" />
        <SkeletonBox className="h-5 w-16 bg-tft-surface/60" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-tft-border bg-tft-surface/30 p-4 space-y-2">
            <SkeletonBox className="h-3 w-16 bg-tft-surface/60" />
            <SkeletonBox className="h-6 w-12" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border border-tft-border rounded-xl bg-tft-surface/30 p-3 flex items-center gap-3">
            <SkeletonBox className="h-5 w-5" />
            <SkeletonBox className="h-4 w-20" />
            <div className="flex gap-1 flex-1">
              {Array.from({ length: 6 }).map((_, j) => (
                <SkeletonBox key={j} className="w-9 h-9 rounded-lg bg-tft-surface/60" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LandingSkeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-tft-border bg-tft-surface/40 p-5 space-y-4">
          <SkeletonBox className="h-4 w-32" />
          {Array.from({ length: 5 }).map((_, j) => (
            <div key={j} className="flex items-center gap-3">
              <SkeletonBox className="w-9 h-9 rounded-lg" />
              <SkeletonBox className="h-3 w-24 bg-tft-surface/60 flex-1" />
              <SkeletonBox className="h-4 w-10 bg-tft-surface/60" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const variants: Record<SkeletonVariant, () => React.JSX.Element> = {
  cards: CardsSkeleton,
  table: TableSkeleton,
  feed: FeedSkeleton,
  explorer: ExplorerSkeleton,
  profile: ProfileSkeleton,
  landing: LandingSkeleton,
};

export default function PageSkeleton({ variant }: { variant: SkeletonVariant }) {
  const Component = variants[variant];
  return <Component />;
}
