#!/usr/bin/env python3
"""
Simple example of using the research pipeline
"""

from research import research

def main():
    """Run simple research examples"""
    
    print("🔬 Simple Research Pipeline Examples")
    print("=" * 50)
    
    # Example questions
    questions = [
        "What can you tell me about Founders house L26?"
    ]
    
    for i, question in enumerate(questions, 1):
        print(f"\n📚 Example {i}:")
        print("=" * 50)
        
        try:
            result = research(question)
            
            if result["step"] == "complete":
                print("✅ Research completed successfully!")
            else:
                print(f"❌ Research failed at: {result['step']}")
                
        except Exception as e:
            print(f"❌ Error: {e}")
        
        print("\n" + "="*50)

if __name__ == "__main__":
    main()
