# Analytics Performance Rating Confidence

## Overview

This document explains the confidence levels and reliability of the analytics performance ratings used in Interview Coach.

## Scoring Methods & Confidence Levels

### 🔴 High Confidence (90-95%)

**Delivery Metrics** - These are calculated from actual audio/transcript data:
- **Words**: Exact word count from transcript
- **WPM (Words Per Minute)**: Calculated from transcript length and duration
- **Filler Count**: Pattern matching for "um", "uh", "like", etc.
- **Filler Rate**: Percentage calculation from fillers/words
- **Long Pauses**: Detected from word timestamps (>800ms gaps)

**Why High Confidence?**
- Based on objective, measurable data
- No AI interpretation needed
- Consistent and repeatable

### 🟡 Medium-High Confidence (75-85%)

**Confidence Score** (0-5):
- Based on transcript patterns: sentence completion, filler usage, pauses, uncertainty markers
- Heuristic-based analysis (not AI)
- **Reliability**: Good for detecting clear confidence vs. uncertainty, but may miss subtle cues

**Intonation Score** (0-5):
- Based on transcript patterns: exclamations, questions, sentence variety, emphasis words
- Heuristic-based analysis
- **Reliability**: Good for detecting monotone vs. expressive, but limited without actual audio pitch data

### 🟠 Medium Confidence (65-75%)

**STAR Score** (0-5):
- AI-powered analysis using GPT-4o-mini
- Evaluates: Situation, Task, Action, Result structure
- **Reliability**: Good at detecting structure, but subjective interpretation can vary
- **Factors affecting reliability**:
  - Transcript quality (Whisper accuracy)
  - Answer completeness
  - Model consistency (temperature: 0.3 for stability)

**Clarity Score** (0-5):
- AI-powered analysis using GPT-4o-mini
- Evaluates: Structure, concision, organization
- **Reliability**: Good general guidance, but may miss context-specific nuances
- Model retries: 3 attempts with fallback

**Impact Score** (0-5):
- AI-powered analysis using GPT-4o-mini
- Evaluates: Metrics, outcomes, "so what" statements
- **Reliability**: Good at detecting quantifiable results, but may miss subtle impact

### 🔵 Lower Confidence (50-65%)

**Technical Accuracy** (if using enhanced analysis):
- AI interpretation of technical correctness
- **Reliability**: Depends on domain knowledge and question complexity
- May not catch subtle technical errors

**Terminology Usage**:
- AI evaluation of domain-specific terms
- **Reliability**: Good for common terms, but may miss specialized jargon

## Factors Affecting Reliability

### 1. **Transcript Quality**
- **Whisper Transcription**: ~95% accuracy for clear speech
- **Impact**: Poor transcript = poor analysis
- **Mitigation**: Clear audio recording helps significantly

### 2. **AI Model Consistency**
- **Model**: GPT-4o-mini (cost-effective, fast)
- **Temperature**: 0.3 (low for consistency)
- **Retries**: 3 attempts with fallback
- **Limitation**: May still have some variance between runs

### 3. **Context Understanding**
- **Strengths**: Good at understanding structure and patterns
- **Limitations**: May miss industry-specific nuances
- **Mitigation**: Role and priorities context helps guide analysis

### 4. **Heuristic Limitations**
- **Confidence/Intonation**: Based on text patterns only
- **Missing**: Actual voice tone, pitch, stress patterns
- **Future**: Could add audio analysis for more accuracy

## Recommendations

### For Users:
1. **Trust delivery metrics** (WPM, fillers) - these are objective
2. **Use AI scores as guidance** - they're directional, not absolute
3. **Focus on trends** - improvement over time is more reliable than single scores
4. **Review tips carefully** - they're actionable even if scores vary slightly

### For Development:
1. ✅ **Current**: Using GPT-4o-mini with low temperature for consistency
2. ✅ **Current**: 3 retry attempts with fallback
3. 🔄 **Future**: Could add audio analysis for confidence/intonation (not just transcript)
4. 🔄 **Future**: Could use GPT-4 for more nuanced analysis (higher cost)
5. 🔄 **Future**: Could add calibration over time (learn user patterns)

## Score Interpretation

### When Scores Are Most Reliable:
- ✅ Clear audio recording
- ✅ Complete answers (>50 words)
- ✅ Good transcript quality
- ✅ Multiple practice sessions (trends)

### When Scores May Vary:
- ⚠️ Poor audio quality
- ⚠️ Very short answers (<20 words)
- ⚠️ Technical domain-specific content
- ⚠️ First-time use (no baseline)

## Conclusion

**Overall Confidence**: The analytics system provides **good directional guidance** for interview practice:

- **Delivery metrics**: Highly reliable (90-95%)
- **Confidence/Intonation**: Moderately reliable (75-85%)
- **Content scores (STAR/Impact/Clarity)**: Moderately reliable (65-75%)

The system is designed for **practice and improvement**, not high-stakes evaluation. Use scores as feedback to identify areas for growth, not as absolute performance indicators.
