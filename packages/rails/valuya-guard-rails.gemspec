Gem::Specification.new do |spec|
  spec.name          = "valuya-guard-rails"
  spec.version       = "0.2.0.beta.1"
  spec.authors       = ["Valuya"]
  spec.summary       = "Valuya Guard middleware for Rails"
  spec.description   = "Rack middleware and controller filter helpers for Valuya Guard payment-aware authorization"
  spec.license       = "MIT"
  spec.files         = Dir["lib/**/*.rb", "README.md"]
  spec.require_paths = ["lib"]

  spec.required_ruby_version = ">= 3.1"

  spec.add_dependency "faraday", ">= 2.0"
  spec.add_dependency "rack", ">= 2.2"
  spec.add_dependency "railties", ">= 7.0"

  spec.add_development_dependency "rspec", ">= 3.13"
end
