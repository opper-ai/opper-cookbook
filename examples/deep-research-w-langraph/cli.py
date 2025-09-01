#!/usr/bin/env python3
"""
CLI client for the research pipeline.
Accepts research questions from stdin and executes the pipeline.
"""

import os
import sys
import argparse
from research import research

def main():
    """Main CLI function"""
    parser = argparse.ArgumentParser(
        description="Research Pipeline CLI - Ask questions and get AI-powered research reports",
        epilog="Example: python3 cli.py --question 'What are the benefits of renewable energy?'"
    )
    
    parser.add_argument(
        "--question", "-q",
        type=str,
        help="Research question to investigate"
    )
    
    parser.add_argument(
        "--interactive", "-i",
        action="store_true",
        help="Interactive mode - keep asking questions"
    )
    
    parser.add_argument(
        "--stdin",
        action="store_true", 
        help="Read question from stdin"
    )
    
    args = parser.parse_args()
    
    # Check for API key
    if not os.getenv("OPPER_API_KEY"):
        print("❌ Error: OPPER_API_KEY environment variable not set")
        print("   Please set your API key: export OPPER_API_KEY='your_key_here'")
        sys.exit(1)
    
    print("🔬 Research Pipeline CLI")
    print("=" * 40)
    
    try:
        if args.stdin:
            # Read from stdin
            print("📝 Enter your research question (press Ctrl+D when done):")
            question = sys.stdin.read().strip()
            if question:
                execute_research(question)
            else:
                print("❌ No question provided via stdin")
                
        elif args.question:
            # Use command line argument
            execute_research(args.question)
            
        elif args.interactive:
            # Interactive mode
            interactive_mode()
            
        else:
            # Default: prompt for single question
            question = input("📝 Enter your research question: ").strip()
            if question:
                execute_research(question)
            else:
                print("❌ No question provided")
                
    except KeyboardInterrupt:
        print("\n\n👋 Research cancelled by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")

def execute_research(question: str):
    """Execute research for a given question"""
    print(f"\n🚀 Researching: {question}")
    print("-" * 60)
    
    try:
        result = research(question)
        
        if result["step"] == "complete":
            print(f"\n✅ Research completed successfully!")
            
            # Show quick summary
            report = result.get("final_report", {})
            citations = report.get("citations", [])
            search_results = result.get("search_results", [])
            
            print(f"📊 Quick Stats:")
            print(f"  • Sources found: {len(search_results)}")
            print(f"  • Citations: {len(citations)}")
            
            if result.get("span_id"):
                print(f"  • Trace: https://platform.opper.ai/traces/{result['span_id']}")
        else:
            print(f"\n❌ Research failed at step: {result['step']}")
            if result.get("errors"):
                for error in result["errors"]:
                    print(f"    - {error}")
                    
    except Exception as e:
        print(f"❌ Research failed: {e}")

def interactive_mode():
    """Interactive mode for multiple questions"""
    print("\n🔄 Interactive Mode")
    print("Type your questions (or 'quit' to exit)")
    print("-" * 40)
    
    question_count = 0
    
    while True:
        try:
            question = input(f"\n[Q{question_count + 1}] Your question: ").strip()
            
            if question.lower() in ['quit', 'exit', 'q']:
                print("👋 Goodbye!")
                break
                
            if question:
                question_count += 1
                execute_research(question)
                
                # Ask if they want to continue
                continue_prompt = input("\n❓ Research another question? (y/n): ").strip().lower()
                if continue_prompt in ['n', 'no']:
                    print("👋 Goodbye!")
                    break
            else:
                print("❌ Please enter a question")
                
        except EOFError:
            print("\n👋 Goodbye!")
            break

if __name__ == "__main__":
    main()
