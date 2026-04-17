/**
 * Composants de squelette animé pour les états de chargement.
 */

/** Ligne de squelette générique */
export function SkeletonLine({ width = '100%', height = 14, mb = 8 }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: 4, marginBottom: mb }}
    />
  )
}

/** Squelette du panneau de statistiques */
export function StatsSkeleton() {
  return (
    <div className="panel">
      {/* Infos mission */}
      <SkeletonLine width="65%" height={20} mb={6} />
      <SkeletonLine width="38%" height={12} mb={16} />

      {/* KPIs */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="kpi">
            <SkeletonLine height={26} mb={6} />
            <SkeletonLine width="55%" height={10} mb={0} />
          </div>
        ))}
      </div>

      {/* Graphique 1 */}
      <SkeletonLine width="45%" height={12} mb={10} />
      <SkeletonLine height={165} mb={16} />

      {/* Graphique 2 */}
      <SkeletonLine width="45%" height={12} mb={10} />
      <SkeletonLine height={145} mb={0} />
    </div>
  )
}

/** Squelette du panneau de tendance */
export function TrendSkeleton() {
  return (
    <div className="trend-panel">
      <SkeletonLine width="50%" height={14} mb={6} />
      <SkeletonLine width="78%" height={12} mb={20} />
      <SkeletonLine height={200} mb={12} />
      <SkeletonLine height={38} mb={0} />
    </div>
  )
}
