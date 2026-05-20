import pandas as pd
import numpy as np
from xgboost import XGBRegressor # <-- Le nouvel algorithme !
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

print("🌱 1. Modélisation biophysique du verger (Équation FAO)...")
np.random.seed(42)
n_trees = 800 

hauteur = np.clip(np.random.normal(loc=3.2, scale=0.6, size=n_trees), 1.2, 5.5)
cwsi_ete = np.clip(np.random.normal(loc=0.45, scale=0.25, size=n_trees), 0.0, 1.0)
temp_moy = 28.0 + (cwsi_ete * 10.0) + np.random.normal(0, 1.5, n_trees)

rendement_potentiel = np.maximum(0, (hauteur - 1.0) * 12.0)
Ky = 0.70  
rendement_theorique = rendement_potentiel * (1.0 - (Ky * cwsi_ete))

bruit_naturel = np.random.normal(loc=0.0, scale=2.5, size=n_trees)
rendement_final = np.clip(rendement_theorique + bruit_naturel, 0.0, None)

df = pd.DataFrame({
    'hauteur': hauteur,
    'cwsi': cwsi_ete,
    'temp_moy': temp_moy,
    'rendement_kg': rendement_final
})

print("\n🧠 2. Apprentissage du modèle (XGBoost)...")
X = df[['hauteur', 'cwsi', 'temp_moy']]
y = df['rendement_kg']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# --- Configuration de XGBoost ---
model = XGBRegressor(
    n_estimators=150,      # Nombre d'arbres en séquence
    max_depth=5,           # Les arbres XGBoost sont généralement moins profonds
    learning_rate=0.1,     # Vitesse d'apprentissage (très important !)
    random_state=42,
    n_jobs=-1              # Utilise toute la puissance de ton processeur
)
model.fit(X_train, y_train)

print("\n🎯 3. Validation croisée du modèle...")
predictions = model.predict(X_test)
mae = mean_absolute_error(y_test, predictions)
r2 = r2_score(y_test, predictions)

print(f"Erreur Absolue Moyenne (MAE) : ± {mae:.2f} kg/arbre")
print(f"Coefficient de détermination (R²) : {r2:.2f}")

print("\n💾 4. Exportation du modèle...")
joblib.dump(model, 'modele_rendement_olivier.joblib')
print("✅ Fichier 'modele_rendement_olivier.joblib' généré avec XGBoost !")