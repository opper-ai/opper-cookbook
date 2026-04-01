"""
Reporting node - Generates the final research report with citations.
"""

from typing import Dict, Any
from opperai import Opper

from schemas import FinalReport

# Opper client will be set by main module
opper = None


def set_opper_client(client: Opper):
    """Set the Opper client for this module"""
    global opper
    opper = client


def generate_report(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate final research report with proper citations.
    
    This node:
    1. Takes all research findings and analysis
    2. Creates a comprehensive report with inline citations
    3. Generates a properly formatted citation list
    4. Updates the parent span with final results
    
    Args:
        state: Pipeline state containing all research data
        
    Returns:
        Updated state with final report
    """
    try:
        parent_span_id = state.get("span_id")
        
        # Get all cited sources
        cited_sources = state.get("cited_sources", [])
        
        call_params = {
            "name": "generate_final_report",
            "instructions": """Generate a comprehensive research report with proper academic citations. 
            Use inline citations [1], [2], etc. when referencing information from sources.
            Create a proper citations list at the end with numbered references.
            Each statement or fact should be properly attributed to its source.""",
            "output_schema": FinalReport,
            "input": {
                "question": state["question"],
                "analysis": state["analysis"],
                "synthesis": state["synthesis"],
                "sources_with_citations": cited_sources,
                "iteration": state.get("iteration", 1)
            },
            "model": "fireworks/glm-4.5-air"
        }
        if parent_span_id:
            call_params["parent_span_id"] = parent_span_id
        
        result = opper.call(**call_params)
        
        # Update the parent span with final output
        if parent_span_id:
            try:
                opper.spans.update(
                    span_id=parent_span_id,
                    output=result.json_payload
                )
            except Exception as span_error:
                print(f"⚠️ Failed to update span: {span_error}")
        
        return {
            **state,
            "final_report": result.json_payload,
            "step": "complete"
        }
    except Exception as e:
        return {
            **state,
            "errors": state.get("errors", []) + [f"Report generation failed: {e}"],
            "step": "failed"
        }
