import os
import sys

def check_and_fix_errors():
    # List of potential errors and their fixes
    error_patterns = [
        ("Fix syntax errors", "Fix syntax errors"),
        ("Fix name errors", "Fix name errors"),
        # Add more error patterns as needed
    ]

    for root, dirs, files in os.walk("."):
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                with open(file_path, "r") as f:
                    content = f.read()
                    for error, fix in error_patterns:
                        if error in content:
                            print(f"Found {error} in {file_path}")
                            # Apply the fix
                            content = content.replace(error, fix)
                            with open(file_path, "w") as f:
                                f.write(content)
                            print(f"Fixed {error} in {file_path}")

if __name__ == "__main__":
    check_and_fix_errors()