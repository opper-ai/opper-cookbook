"""Reusable bootstrapping engine for creating example datasets."""

from opperai import Opper
from typing import List, Callable, Any, Optional
import random
import json
import inspect
import re


class BootstrapEngine:
    """Engine for bootstrapping function examples."""
    
    def __init__(self, make_call_func: Callable, 
                 input_schema: Any, output_schema: Any,
                 synthetic_inputs: Optional[List[Any]] = None,
                 auto_generate_inputs: bool = False,
                 convert_input_func: Optional[Callable] = None,
                 format_output_func: Optional[Callable] = None,
                 save_input_func: Optional[Callable] = None,
                 save_output_func: Optional[Callable] = None,
                 refinement_model: Optional[str] = None):
        self.make_call = make_call_func
        self.input_schema = input_schema
        self.output_schema = output_schema
        self.refinement_model = refinement_model
        
        # Extract metadata from make_call
        self.function_name = self._extract_function_name()
        self.instructions = self._extract_instructions()
        
        # Handle synthetic inputs - either provided or auto-generated on-demand
        self.auto_generate_inputs = auto_generate_inputs
        self.synthetic_inputs = synthetic_inputs
        
        # Use provided helper functions or defaults
        self.convert_input = convert_input_func or self._default_convert_input
        self.format_output = format_output_func or self._default_format_output
        self.save_input = save_input_func or self._default_save_input
        self.save_output = save_output_func or self._default_save_output
        
        self._function = None
        self._dataset_id = None
    
    def _extract_function_name(self) -> Optional[str]:
        """Extract function name from make_call function by inspecting its source."""
        try:
            source = inspect.getsource(self.make_call)
            # Look for name="..." or name='...' pattern
            match = re.search(r'name\s*=\s*["\']([^"\']+)["\']', source)
            if match:
                return match.group(1)
        except Exception:
            pass
        return None
    
    def _extract_instructions(self) -> Optional[str]:
        """Extract instructions from make_call function by inspecting its source."""
        try:
            source = inspect.getsource(self.make_call)
            # Look for instructions="..." or instructions='...' pattern (multi-line aware)
            # Handle triple-quoted strings first (""" or ''')
            triple_quote_patterns = [
                r'instructions\s*=\s*"""(.*?)"""',  # Triple double quotes
                r"instructions\s*=\s*'''(.*?)'''",  # Triple single quotes
            ]
            for pattern in triple_quote_patterns:
                match = re.search(pattern, source, re.DOTALL)
                if match:
                    instructions = match.group(1).strip()
                    # Remove common leading whitespace
                    lines = instructions.split('\n')
                    if len(lines) > 1:
                        # Remove common leading indentation
                        non_empty_lines = [l for l in lines if l.strip()]
                        if non_empty_lines:
                            leading_spaces = len(non_empty_lines[0]) - len(non_empty_lines[0].lstrip())
                            if leading_spaces > 0:
                                instructions = '\n'.join(l[leading_spaces:] if len(l) > leading_spaces else l for l in lines)
                    return instructions
            
            # Fallback to single/double quotes (for single-line instructions)
            single_quote_pattern = r'instructions\s*=\s*["\']([^"\']*)["\']'
            match = re.search(single_quote_pattern, source)
            if match:
                return match.group(1).strip()
        except Exception:
            pass
        return None
    
    def _default_convert_input(self, raw_input: Any) -> dict:
        """Default: Convert input to dict format."""
        if isinstance(raw_input, dict):
            return raw_input
        if hasattr(raw_input, 'model_dump'):
            return raw_input.model_dump()
        if hasattr(raw_input, '__dict__'):
            return raw_input.__dict__
        return raw_input
    
    def _default_format_output(self, output: dict) -> str:
        """Default: Format output for display."""
        if isinstance(output, dict):
            # Try to find a main content field (changelog, summary, result, etc.)
            for key in ['changelog', 'summary', 'result', 'output', 'text', 'content']:
                if key in output:
                    content = output[key]
                    if isinstance(content, str):
                        # Indent each line for better display
                        lines = content.split('\n')
                        indented = ['  ' + line if line.strip() else line for line in lines]
                        return '\n'.join(indented)
            # Otherwise pretty print the whole dict
            return json.dumps(output, indent=2)
        return str(output)
    
    def _default_save_input(self, raw_input: Any, input_schema: Any = None) -> dict:
        """Default: Convert input to dict for saving."""
        if input_schema is None:
            input_schema = self.input_schema
            
        if isinstance(raw_input, dict):
            # Validate with schema if it's a Pydantic model
            try:
                if input_schema and hasattr(input_schema, 'model_validate'):
                    instance = input_schema.model_validate(raw_input)
                    return instance.model_dump()
            except Exception:
                pass
            return raw_input
        if hasattr(raw_input, 'model_dump'):
            return raw_input.model_dump()
        if hasattr(raw_input, '__dict__'):
            return raw_input.__dict__
        return raw_input
    
    def _default_save_output(self, output: dict, output_schema: Any = None) -> dict:
        """Default: Convert output to dict for saving."""
        if output_schema is None:
            output_schema = self.output_schema
            
        if isinstance(output, dict):
            # Validate with schema if it's a Pydantic model
            try:
                if output_schema and hasattr(output_schema, 'model_validate'):
                    instance = output_schema.model_validate(output)
                    return instance.model_dump()
            except Exception:
                pass
            return output
        return output
    
    def generate_synthetic_input(self, existing_examples: List[dict], opper: Optional[Opper] = None):
        """Generate a synthetic input by randomly selecting from the pool or generating on-demand."""
        # If manual inputs provided, use those
        if self.synthetic_inputs:
            return random.choice(self.synthetic_inputs)
        
        # If auto-generation enabled, generate one input on-demand
        if self.auto_generate_inputs:
            if opper is None:
                raise ValueError("Opper client required for auto-generating inputs. Provide opper in run() call.")
            if not existing_examples:
                print("🤖 Generating synthetic input from schema...")
            return self._generate_single_input_from_schema(opper, existing_examples)
        
        raise ValueError("No synthetic inputs available. Provide synthetic_inputs or enable auto_generate_inputs.")
    
    def _generate_single_input_from_schema(self, opper: Opper, existing_examples: List[dict]) -> dict:
        """Generate a single diverse synthetic input using the function's instructions and input schema."""
        # Get schema information
        input_schema_json = self.input_schema.model_json_schema() if hasattr(self.input_schema, 'model_json_schema') else {}
        instructions = self.instructions or "Generate diverse, realistic input examples for this function."
        
        # Build instructions for generation
        generation_instructions = "Generate a single diverse synthetic input example based on the provided schema and instructions."
        if existing_examples:
            generation_instructions += f" You have already generated {len(existing_examples)} examples. Ensure the new example is diverse and different from previous examples."
        
        try:
            result = opper.call(
                name="generate_synthetic_input",
                instructions=generation_instructions,
                input={
                    "function_instructions": instructions,
                    "schema": input_schema_json,
                    "existing_count": len(existing_examples)
                },
                output_schema=input_schema_json
            )
            
            generated = result.json_payload
            
            # Validate the generated example against the schema
            try:
                if hasattr(self.input_schema, 'model_validate'):
                    instance = self.input_schema.model_validate(generated)
                    return instance.model_dump()
                else:
                    return generated
            except Exception as e:
                print(f"⚠️  Generated invalid example: {e}, regenerating...")
                # Retry once if validation fails
                return self._generate_single_input_from_schema(opper, existing_examples)
            
        except Exception as e:
            print(f"⚠️  Warning: Could not generate synthetic input: {e}")
            raise ValueError(f"Failed to generate synthetic input. Please provide synthetic_inputs manually.")
    
    def call_with_input(self, opper, raw_input, saved_examples: List[dict] = None) -> dict:
        """Call opper.call() with the given input and examples."""
        call_input = self.convert_input(raw_input)
        
        examples = None
        if saved_examples:
            examples = [{"input": ex["input"], "output": ex["output"]} for ex in saved_examples]
            examples = examples[-3:] if len(examples) > 3 else examples
        
        result = self.make_call(opper, call_input, examples=examples)
        return result.json_payload
    
    def display_example(self, raw_input, output: dict, example_num: int):
        """Display an example to the user."""
        print("\n" + "="*70)
        print(f"EXAMPLE {example_num}")
        print("="*70)
        print("\n📥 RAW INPUT:")
        if isinstance(raw_input, dict):
            print(json.dumps(raw_input, indent=2))
        else:
            print(f"  {raw_input}")
        print("\n📤 OUTPUT:")
        print(self.format_output(output))
        print("="*70)
    
    def get_user_feedback(self) -> tuple[int, str]:
        """Collect user feedback on the example."""
        print("\nPlease rate this example and provide feedback:")
        
        while True:
            try:
                rating = int(input("Rating (1-5, where 5 is perfect): "))
                if 1 <= rating <= 5:
                    break
                print("Please enter a number between 1 and 5")
            except ValueError:
                print("Please enter a valid number")
        
        comments = input("Comments (what should be improved?): ").strip()
        return rating, comments
    
    def refine_example_with_feedback(self, opper, raw_input, 
                                   current_output: dict, feedback: str) -> dict:
        """Refine an example based on user feedback."""
        if not feedback:
            return current_output
        
        instruction = f"""Given the original input and the current output, refine the output based on this user feedback:

USER FEEDBACK: {feedback}

Original input: {raw_input}
Current output: {current_output}

Please provide an improved version that addresses the feedback while maintaining accuracy."""
        
        result = opper.call(
            name="refine_example",
            instructions=instruction,
            input={"raw": raw_input, "current": current_output, "feedback": feedback},
            output_schema=self.output_schema.model_json_schema(),
            model=self.refinement_model if self.refinement_model else None
        )
        
        return result.json_payload
    
    def _get_function(self, opper, retry: bool = True):
        """Get or retrieve the function by name."""
        if self._function is not None and self._dataset_id:
            return self._function
        
        if not self.function_name:
            if retry:
                return None
            print("⚠️  Warning: Could not extract function name. Examples will only be saved in memory.")
            return None
        
        try:
            self._function = opper.functions.get_by_name(name=self.function_name)
            self._dataset_id = getattr(self._function, 'dataset_id', None)
            if self._dataset_id and retry:
                print(f"✓ Found function '{self.function_name}' with dataset_id: {self._dataset_id}")
            return self._function
        except Exception as e:
            if not retry:
                # Silently fail on retry attempts
                return None
            # Only print warning on first attempt
            return None
    
    def save_example(self, opper, raw_input, output: dict, comments: str, saved_examples: List[dict]) -> tuple[bool, dict]:
        """Save an approved example to memory and function dataset."""
        example = {
            "input": self.convert_input(raw_input),
            "output": output,
            "raw_input": raw_input,
            "comments": comments
        }
        saved_examples.append(example)
        
        # Try to save to function's dataset (retry silently if function wasn't found initially)
        function = self._get_function(opper, retry=False)
        if function and self._dataset_id:
            try:
                # Convert to proper format - use dict, not string
                call_input = self.convert_input(raw_input)
                # Ensure output is a dict
                output_dict = output if isinstance(output, dict) else output
                
                opper.datasets.create_entry(
                    dataset_id=self._dataset_id,
                    input=call_input,
                    output=output_dict,
                    comment=comments
                )
                print(f"✓ Example saved to function dataset! ({len(saved_examples)} total examples)")
            except Exception as e:
                print(f"⚠️  Warning: Could not save to dataset: {e}")
                print(f"✓ Example saved in memory ({len(saved_examples)} total examples)")
        else:
            print(f"✓ Example saved in memory ({len(saved_examples)} total examples)")
        
        return True, example
    
    def run(self, opper, title: str = "Example Bootstrapper"):
        """Run the interactive bootstrapping session."""
        print("="*70)
        print(f"  {title}")
        print("="*70)
        
        # Try to get the function to verify it exists and cache dataset_id
        function = self._get_function(opper, retry=True)
        if function and self._dataset_id:
            print(f"\n✓ Function '{self.function_name}' found")
            print(f"✓ Dataset ID: {self._dataset_id}")
            print(f"✓ Examples will be saved to function dataset")
        elif function:
            print(f"\n✓ Function '{self.function_name}' found")
            print("⚠️  Warning: Function has no dataset_id. Examples will only be saved in memory.")
        else:
            if self.function_name:
                print(f"\n⚠️  Function '{self.function_name}' not found yet.")
                print("  It will be created on first opper.call(). Examples will be saved after first call.")
            else:
                print(f"\n⚠️  Could not determine function name. Examples will only be saved in memory.")
        
        print(f"\n✓ Ready to bootstrap examples")
        if self.auto_generate_inputs:
            print(f"  Auto-generating synthetic inputs on-demand from schema")
        elif self.synthetic_inputs:
            print(f"  Using {len(self.synthetic_inputs)} provided synthetic inputs")
        print(f"  Will use up to 3 examples in context (few-shot learning)")
        
        saved_examples = []
        example_count = 0
        
        print("\n" + "="*70)
        print("Starting interactive example generation...")
        print("Rate each example 1-5. Examples rated 5/5 will be saved.")
        print("="*70)
        
        while True:
            example_count += 1
            
            print(f"\n\nGenerating example {example_count}...")
            raw_input = self.generate_synthetic_input(saved_examples, opper=opper)
            
            print("Calling with examples...")
            output = self.call_with_input(opper, raw_input, saved_examples)
            
            self.display_example(raw_input, output, example_count)
            rating, comments = self.get_user_feedback()
            
            # Continue refining until we get a 5/5 rating
            while rating < 5:
                if not comments:
                    print("Please provide comments on what to improve to continue refining.")
                    rating, comments = self.get_user_feedback()
                    if rating == 5:
                        break
                    if not comments:
                        print("⚠️  Skipping refinement - no comments provided.")
                        break
                
                print(f"\n🔄 Refining example based on your feedback...")
                refined_output = self.refine_example_with_feedback(opper, raw_input, output, comments)
                
                print("\n📤 REFINED OUTPUT:")
                print(self.format_output(refined_output))
                
                while True:
                    better = input("\nIs this better? (y/n): ").lower()
                    if better in ['y', 'yes']:
                        # Use refined output as new baseline and get new rating
                        output = refined_output
                        rating, comments = self.get_user_feedback()
                        break
                    elif better in ['n', 'no']:
                        # Refined version isn't better, but use it as baseline for next refinement
                        # Get new feedback about what's still wrong
                        print("\nWhat still needs to be improved?")
                        rating, comments = self.get_user_feedback()
                        # Update output to refined version for next iteration
                        output = refined_output
                        # Continue the while loop with new feedback
                        break
                    else:
                        print("Please enter 'y' or 'n'")
            
            if rating == 5:
                self.save_example(opper, raw_input, output, comments, saved_examples)
            
            print("\n" + "="*70)
            cont = input("Generate another example? (y/n, or 'q' to quit): ").lower()
            if cont in ['q', 'quit', 'n', 'no', '']:
                break
        
        print("\n" + "="*70)
        print("SUMMARY")
        print("="*70)
        print(f"✓ Total examples generated: {example_count}")
        print(f"✓ Examples saved: {len(saved_examples)}")
        print(f"\nUse config.make_call() in your application with these examples!")
