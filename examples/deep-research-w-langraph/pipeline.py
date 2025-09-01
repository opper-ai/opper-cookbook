"""
Main research pipeline using LangGraph.
"""

from typing import Dict, Any
from langgraph.graph import StateGraph, END
from opperai import Opper

from nodes import (
    analyze_question,
    execute_search,
    execute_additional_search, 
    synthesize_findings,
    generate_report,
    should_improve
)
from utils import set_opper_client as set_utils_opper_client
from nodes.planning import set_opper_client as set_planning_opper_client
from nodes.search import set_opper_client as set_search_opper_client
from nodes.synthesis import set_opper_client as set_synthesis_opper_client
from nodes.reporting import set_opper_client as set_reporting_opper_client


def set_opper_client(client: Opper):
    """Set the Opper client for all modules"""
    set_utils_opper_client(client)
    set_planning_opper_client(client)
    set_search_opper_client(client)
    set_synthesis_opper_client(client)
    set_reporting_opper_client(client)


def create_research_pipeline():
    """
    Create the research pipeline with iterative refinement and quality review.
    
    Pipeline Flow:
    1. Plan: Analyze question + generate queries
    2. Search: Execute searches + extract facts
    3. Synthesize: Analyze findings + identify gaps
    4. Decision: Check if more research needed
    5. Additional Search: Fill gaps if needed
    6. Final Synthesis: Re-synthesize with new data
    7. Report: Generate final report with citations
    """
    workflow = StateGraph(dict)
    
    # Add nodes - simplified flow: plan, search, synthesise, search again if gaps, synthesise, final report
    workflow.add_node("plan", analyze_question)
    workflow.add_node("search", execute_search)
    workflow.add_node("synthesize", synthesize_findings)
    workflow.add_node("additional_search", execute_additional_search)
    workflow.add_node("final_synthesis", synthesize_findings)
    workflow.add_node("report", generate_report)
    
    # Set entry point
    workflow.set_entry_point("plan")
    
    # Simple linear flow
    workflow.add_edge("plan", "search")
    workflow.add_edge("search", "synthesize")
    
    # Check if additional search is needed based on synthesis gaps
    workflow.add_conditional_edges(
        "synthesize",
        should_improve,
        {
            "improve": "additional_search",
            "generate_final": "report"
        }
    )
    
    # Additional search flow
    workflow.add_edge("additional_search", "final_synthesis")
    workflow.add_edge("final_synthesis", "report")
    workflow.add_edge("report", END)
    
    return workflow.compile()
