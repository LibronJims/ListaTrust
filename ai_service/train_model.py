# train_model.py
# Trains Random Forest Classifier for trust score prediction
# Manuscript Reference: Section 2.5.1 - AI Core Feature

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import pickle
import numpy as np

print("🤖 Training AI Model for ListaTrust...")
print("=" * 50)

# Load dataset
try:
    df = pd.read_csv('dataset.csv')
    print(f"✅ Loaded dataset with {len(df)} samples")
    print(f"   Features: {df.columns.tolist()}")
except Exception as e:
    print(f"❌ Failed to load dataset: {e}")
    exit(1)

# Features and target
feature_columns = ['total_borrowed', 'total_repaid', 'active_debts', 'completed_debts', 'on_time_payments']
X = df[feature_columns]
y = df['trust_level']

print(f"\n📊 Feature Statistics:")
print(f"   Total Borrowed: {X['total_borrowed'].min()} - {X['total_borrowed'].max()}")
print(f"   Active Debts: {X['active_debts'].min()} - {X['active_debts'].max()}")
print(f"   Target Classes: {y.unique().tolist()}")

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
print(f"\n📊 Data Split:")
print(f"   Training samples: {len(X_train)}")
print(f"   Testing samples: {len(X_test)}")

# Train model
print(f"\n🚀 Training Random Forest Classifier...")
model = RandomForestClassifier(
    n_estimators=100,
    max_depth=10,
    random_state=42,
    class_weight='balanced'
)
model.fit(X_train, y_train)

# Test accuracy
y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
print(f"\n📈 Model Performance:")
print(f"   Accuracy: {accuracy * 100:.2f}%")

# Detailed classification report
print(f"\n📋 Classification Report:")
print(classification_report(y_test, y_pred))

# Feature importance
importance = model.feature_importances_
print(f"\n🔍 Feature Importance (RFM Analysis):")
for feature, imp in zip(feature_columns, importance):
    print(f"   {feature}: {imp*100:.1f}%")

# Save model
with open('trust_model.pkl', 'wb') as f:
    pickle.dump(model, f)
print(f"\n✅ Model saved as 'trust_model.pkl'")

# Quick test
test_sample = np.array([[1500, 1200, 1, 6, 5]])  # Example: good payer
prediction = model.predict(test_sample)[0]
probabilities = model.predict_proba(test_sample)[0]
confidence = max(probabilities) * 100

print(f"\n🧪 Quick Test:")
print(f"   Sample: total_borrowed=1500, total_repaid=1200, active_debts=1, completed_debts=6, on_time=5")
print(f"   Prediction: {prediction}")
print(f"   Confidence: {confidence:.1f}%")
print("=" * 50)