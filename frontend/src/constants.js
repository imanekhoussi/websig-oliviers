export const STRESS_COLORS = {
  aucun:   '#2ecc71',
  faible:  '#f1c40f',
  modere:  '#e67e22',
  eleve:   '#e74c3c',
  severe:  '#8e44ad',
  inconnu: '#64748b',
}

export const STRESS_LABELS = {
  aucun: 'Aucun stress',
  faible: 'Stress faible',
  modere: 'Stress modéré',
  eleve: 'Stress élevé',
  severe: 'Stress sévère',
  inconnu: 'Inconnu',
}

export const DEFAULT_CWSI_THRESHOLDS = [0.1, 0.3, 0.5, 0.7]

export const SETTINGS_KEY = 'geoOlive_parcel_settings'

export const DEFAULT_SETTINGS = {
  parcelName: '',
  owner: '',
  variety: 'Picholine marocaine',
  surface: '',
  cwsiThresholds: [0.1, 0.3, 0.5, 0.7],
  kcHiver: 0.45,
  kcPrintemps: 0.65,
  kcEte: 0.70,
  irrigationType: 'goutte_a_goutte',
  irrigationEfficiency: 0.90,
  pumpFlow: 5,
  waterCost: 0,
  energyKwh: 0.75,
  energyPrice: 1.05,
}
