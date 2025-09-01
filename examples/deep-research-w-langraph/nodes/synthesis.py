"""
Synthesis node - Analyzes and synthesizes research findings.
"""

from typing import Dict, Any
from opperai import Opper

from schemas import ResearchSynthesis
from utils import prepare_sources_for_citation

# Opper client will be set by main module
opper = None


def set_opper_client(client: Opper):
    """Set the Opper client for this module"""
    global opper
    opper = client


def synthesize_findings(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Synthesize research findings and identify knowledge gaps.
    
    This node:
    1. Prepares sources with citation numbers
    2. Synthesizes all research findings into key insights
    3. Identifies knowledge gaps that need additional research
    4. Creates source summaries for proper attribution
    
    Args:
        state: Pipeline state containing search results
        
    Returns:
        Updated state with synthesis and cited sources
    """
    try:
        parent_span_id = state.get("span_id")
        
        # Prepare sources with citation numbers
        cited_sources = prepare_sources_for_citation(state["search_results"])
        
        call_params = {
            "name": "synthesize_research",
            "instructions": """Synthesize the research findings into key insights and identify knowledge gaps. 
            When referencing information from sources, use the citation numbers provided (e.g., [1], [2], etc.).
            Each source has a citation_number that you should reference when using information from that source.""",
            "output_schema": ResearchSynthesis,
            "input": {
                "question": state["question"],
                "analysis": state["analysis"],
                "sources_with_citations": cited_sources
            },
            "model": "fireworks/glm-4.5-air"
        }
        if parent_span_id:
            call_params["parent_span_id"] = parent_span_id
        
        result = opper.call(**call_params)
        
        synthesis = result.json_payload
        gaps = synthesis.get("gaps", [])
        
        if gaps:
            print(f"📋 Synthesis complete - {len(gaps)} knowledge gaps identified")
        else:
            print("📋 Synthesis complete - comprehensive coverage achieved")
        
        return {
            **state,
            "synthesis": result.json_payload,
            "cited_sources": cited_sources,
            "step": "synthesis_complete"
        }
    except Exception as e:
        return {
            **state,
            "errors": state.get("errors", []) + [f"Synthesis failed: {e}"],
            "step": "failed"
        }
