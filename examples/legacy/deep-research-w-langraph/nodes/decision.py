"""
Decision node - Determines if additional research is needed.
"""

from typing import Dict, Any


def should_improve(state: Dict[str, Any]) -> str:
    """
    Decide if additional search is needed based on synthesis gaps.
    
    This function analyzes the synthesis results to determine if the research
    is complete or if additional searches are needed to fill knowledge gaps.
    
    Args:
        state: Pipeline state containing synthesis results
        
    Returns:
        String indicating next step: "improve" or "generate_final"
    """
    synthesis = state.get("synthesis", {})
    gaps = synthesis.get("gaps", [])
    iteration = state.get("iteration", 1)
    
    # Don't improve if we've already done 2 iterations
    if iteration >= 2:
        return "generate_final"
    
    # Improve if synthesis identified significant gaps
    if gaps and len(gaps) > 0:
        print(f"🔍 Found {len(gaps)} knowledge gaps, will search for more information")
        return "improve"
    
    print("✅ No significant gaps found, proceeding to final report")
    return "generate_final"
