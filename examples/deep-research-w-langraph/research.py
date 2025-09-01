"""
Main research execution and result display.
"""

import os
from typing import Dict, Any
from dotenv import load_dotenv
from opperai import Opper

from pipeline import create_research_pipeline, set_opper_client

# Load environment variables
load_dotenv()

# Initialize Opper client
opper = Opper(http_bearer=os.getenv("OPPER_API_KEY"))
set_opper_client(opper)


def research(question: str) -> Dict[str, Any]:
    """
    Execute research for a given question.
    
    This is the main entry point for the research pipeline. It:
    1. Creates a trace span for the entire research session
    2. Executes the research pipeline
    3. Displays comprehensive results with statistics
    
    Args:
        question: The research question to investigate
        
    Returns:
        Complete research results including report and metadata
    """
    print(f"🚀 Starting research: {question}")
    print("-" * 60)
    
    # Create parent span for the entire research session
    try:
        parent_span = opper.spans.create(
            name="research_pipeline",
            input={"question": question}
        )
        span_id = parent_span.id
        print(f"📊 Created trace span: {span_id}")
    except Exception as e:
        print(f"⚠️ Failed to create span: {e}")
        span_id = None
    
    # Create pipeline
    pipeline = create_research_pipeline()
    
    # Initial state with span tracking
    initial_state = {
        "question": question,
        "step": "started",
        "iteration": 1,
        "span_id": span_id,
        "errors": []
    }
    
    # Execute pipeline
    result = pipeline.invoke(initial_state)
    
    # Print results
    if result["step"] == "complete":
        print("\n✅ Research Complete!")
        print("-" * 60)
        
        # Show tracing information
        if result.get("span_id"):
            print(f"📊 Trace ID: {result['span_id']}")
            print(f"🔗 View trace at: https://platform.opper.ai/traces/{result['span_id']}")
            print()
        
        # Show synthesis gaps if additional search was performed
        if "additional_queries" in result:
            gaps = result["synthesis"].get("gaps", [])
            print(f"🔍 Knowledge Gaps Addressed:")
            if gaps:
                print(f"  Original gaps: {', '.join(gaps[:3])}")  # Show first 3
            print(f"  Additional searches: {len(result['additional_queries']['queries'])}")
            print()
        
        report = result["final_report"]
        print(f"📋 Summary:\n{report['summary']}\n")
        print(f"🔍 Key Findings:\n{report['findings']}\n")
        print(f"💡 Conclusions:\n{report['conclusions']}\n")
        
        # Show citations
        citations = report.get('citations', [])
        if citations:
            print("📚 Citations:")
            for citation in citations:
                print(f"  [{citation['number']}] {citation['title']}")
                print(f"      {citation['url']}")
                print(f"      Accessed: {citation['accessed_date']}")
                print()
        
        # Show source breakdown by search type
        search_results = result.get('search_results', [])
        original_sources = len([r for r in search_results if r.get('search_type') != 'gap_filling'])
        gap_filling_sources = len([r for r in search_results if r.get('search_type') == 'gap_filling'])
        total_citations = len(citations)
        
        # Show fact extraction statistics
        search_results = result.get('search_results', [])
        successful_extractions = len([r for r in search_results if r.get("facts_extracted", False)])
        total_facts = sum(len(r.get("key_facts", [])) + len(r.get("supporting_data", [])) + len(r.get("relevant_quotes", [])) for r in search_results)
        
        print(f"📊 Research Statistics:")
        print(f"  Total sources cited: {total_citations}")
        print(f"  Successful fact extractions: {successful_extractions}/{len(search_results)}")
        print(f"  Total facts extracted: {total_facts}")
        if total_facts > 0:
            print(f"  Average facts per source: {total_facts // len(search_results)}")
        if gap_filling_sources > 0:
            print(f"  Initial search sources: {original_sources}")
            print(f"  Gap-filling sources: {gap_filling_sources}")
        
    else:
        print(f"\n❌ Research failed at step: {result['step']}")
        if result.get("errors"):
            for error in result["errors"]:
                print(f"  - {error}")
    
    return result


def main():
    """Main function with example research question"""
    if not os.getenv("OPPER_API_KEY"):
        print("❌ Please set OPPER_API_KEY environment variable")
        return
    
    # Example research
    research("What are the environmental benefits of renewable energy?")


if __name__ == "__main__":
    main()
