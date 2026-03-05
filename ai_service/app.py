# app.py
# Flask API for AI Trust Score Prediction
# Manuscript Reference: Section 2.5.1 - AI Core Feature
# Runs on http://127.0.0.1:5000

from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from Node.js backend

# Global variables
model = None
model_loaded = False
start_time = datetime.now()

# Load trained model on startup
def load_model():
    global model, model_loaded
    try:
        model_path = 'trust_model.pkl'
        if not os.path.exists(model_path):
            print(f"❌ Model file not found at {model_path}")
            return False
        
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        model_loaded = True
        print(f"✅ AI Model loaded successfully at {start_time}")
        print(f"   Model type: {type(model).__name__}")
        return True
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        return False

# Load model at startup
load_model()

@app.route('/predict', methods=['POST'])
def predict():
    """
    Predict trust level based on debtor features
    Expected JSON: {
        "total_borrowed": float,
        "total_repaid": float,
        "active_debts": int,
        "completed_debts": int,
        "on_time_payments": int
    }
    """
    try:
        # Check if model is loaded
        if not model_loaded or model is None:
            return jsonify({
                'error': 'Model not loaded',
                'trust_level': 'MEDIUM',
                'confidence': 0,
                'message': 'Using fallback - model unavailable'
            }), 503

        # Get request data
        data = request.json
        print(f"📥 Received prediction request: {data}")
        
        # Validate required fields
        required_fields = ['total_borrowed', 'total_repaid', 'active_debts', 
                          'completed_debts', 'on_time_payments']
        
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing field: {field}'}), 400
        
        # Prepare features for prediction
        features = np.array([[
            float(data['total_borrowed']),
            float(data['total_repaid']),
            int(data['active_debts']),
            int(data['completed_debts']),
            int(data['on_time_payments'])
        ]])
        
        # Make prediction
        prediction = model.predict(features)[0]
        probabilities = model.predict_proba(features)[0]
        
        # Get confidence score
        confidence = round(max(probabilities) * 100, 2)
        
        # Map prediction to trust level
        trust_level = prediction  # Already HIGH/MEDIUM/LOW
        
        # Get feature importance for this prediction (optional)
        feature_names = ['total_borrowed', 'total_repaid', 'active_debts', 
                        'completed_debts', 'on_time_payments']
        
        response = {
            'trust_level': trust_level,
            'confidence': confidence,
            'message': f'Debtor is {trust_level} risk with {confidence}% confidence',
            'features_used': feature_names,
            'model': 'Random Forest Classifier',
            'timestamp': datetime.now().isoformat()
        }
        
        print(f"📤 Prediction result: {trust_level} ({confidence}%)")
        return jsonify(response)
    
    except Exception as e:
        print(f"❌ Prediction error: {e}")
        return jsonify({'error': str(e)}), 400

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    uptime = datetime.now() - start_time
    return jsonify({
        'status': 'AI Service is running',
        'model_loaded': model_loaded,
        'uptime': str(uptime).split('.')[0],
        'endpoints': ['/predict (POST)', '/health (GET)'],
        'timestamp': datetime.now().isoformat()
    })

@app.route('/info', methods=['GET'])
def info():
    """Get model information"""
    if not model_loaded or model is None:
        return jsonify({'error': 'Model not loaded'}), 503
    
    # Get model parameters
    return jsonify({
        'model_type': type(model).__name__,
        'n_estimators': model.n_estimators if hasattr(model, 'n_estimators') else 'unknown',
        'max_depth': model.max_depth if hasattr(model, 'max_depth') else 'unknown',
        'classes': model.classes_.tolist() if hasattr(model, 'classes_') else [],
        'feature_importance': model.feature_importances_.tolist() if hasattr(model, 'feature_importances_') else [],
        'status': 'ready'
    })

@app.route('/test', methods=['GET'])
def test():
    """Test endpoint with sample prediction"""
    if not model_loaded or model is None:
        return jsonify({'error': 'Model not loaded'}), 503
    
    # Sample good payer
    sample = {
        'total_borrowed': 1500,
        'total_repaid': 1400,
        'active_debts': 1,
        'completed_debts': 7,
        'on_time_payments': 6
    }
    
    features = np.array([[
        sample['total_borrowed'],
        sample['total_repaid'],
        sample['active_debts'],
        sample['completed_debts'],
        sample['on_time_payments']
    ]])
    
    prediction = model.predict(features)[0]
    probabilities = model.predict_proba(features)[0]
    confidence = round(max(probabilities) * 100, 2)
    
    return jsonify({
        'sample_input': sample,
        'prediction': prediction,
        'confidence': confidence,
        'message': f'Test sample predicts {prediction} risk with {confidence}% confidence'
    })

if __name__ == '__main__':
    print("\n" + "="*50)
    print("🚀 Starting ListaTrust AI Service")
    print("="*50)
    print(f"📡 Server will run on: http://127.0.0.1:5000")
    print(f"📊 Model file: trust_model.pkl")
    print(f"🔍 Available endpoints:")
    print(f"   POST /predict - Get trust score prediction")
    print(f"   GET  /health  - Health check")
    print(f"   GET  /info    - Model information")
    print(f"   GET  /test    - Test with sample data")
    print("="*50 + "\n")
    
    app.run(host='127.0.0.1', port=5000, debug=True)